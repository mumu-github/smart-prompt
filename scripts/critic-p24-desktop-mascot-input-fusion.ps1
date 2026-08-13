param(
  [string]$Report = "research/p24-desktop-mascot-input-fusion.latest.json"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

$failures = New-Object System.Collections.Generic.List[string]
function Add-Failure {
  param([string]$Message)
  $failures.Add($Message) | Out-Null
}

function Read-Text {
  param([string]$Path)
  $full = Join-Path $Root $Path
  if (-not (Test-Path -LiteralPath $full)) {
    Add-Failure "Missing required file: $Path"
    return ""
  }
  return Get-Content -Raw -Encoding UTF8 -LiteralPath $full
}

function Assert-Contains {
  param([string]$Text, [string]$Needle, [string]$Label)
  if (-not $Text.Contains($Needle)) {
    Add-Failure "Missing ${Label}: $Needle"
  }
}

function Assert-NotContains {
  param([string]$Text, [string]$Needle, [string]$Label)
  if ($Text.Contains($Needle)) {
    Add-Failure "Unexpected ${Label}: $Needle"
  }
}

$html = Read-Text "apps/desktop-shell/index.html"
$app = Read-Text "apps/desktop-shell/src/app.js"
$css = Read-Text "apps/desktop-shell/src/styles.css"
$staticTest = Read-Text "apps/desktop-shell/tests/desktop-shell.test.js"
$interactionTest = Read-Text "apps/desktop-shell/tests/desktop-shell-interaction.test.js"
$doc = Read-Text "docs/m3-desktop-input.md"

foreach ($needle in @(
  'id="desktop-fusion-console"',
  'id="desktop-mascot-button"',
  'id="desktop-fusion-mascot-image"',
  'id="desktop-draft-input"',
  'id="desktop-generated-prompt"',
  'id="generate-desktop-prompt"',
  'id="fill-foreground-input"',
  'id="desktop-fusion-evidence"'
)) {
  Assert-Contains $html $needle "desktop fusion HTML"
}

foreach ($needle in @(
  "activateDesktopMascot",
  "generateDesktopPrompt",
  "fillForegroundInput",
  "getDesktopSnapshotReadiness",
  "renderDesktopFusionSurface",
  "renderDesktopFusionFillResult",
  "/generate",
  "confirmForeground: true",
  "allowClipboardFallback: true",
  "expectedTitleHash: readiness.titleHash",
  "expectedToolProfile: readiness.profile",
  "candidateIndex: readiness.bestCandidateIndex",
  "desktopFusionFilled",
  "noAutoSubmit"
)) {
  Assert-Contains $app $needle "desktop fusion app logic"
}

foreach ($needle in @(
  ".desktop-fusion-console",
  ".desktop-mascot-button",
  ".desktop-input-surface",
  ".desktop-evidence-row",
  "@keyframes mascot-thinking"
)) {
  Assert-Contains $css $needle "desktop fusion CSS"
}

foreach ($needle in @(
  'id="desktop-mascot-button"',
  "confirmForeground: true",
  "expectedTitleHash: readiness.titleHash",
  "renderDesktopFusionFillResult",
  ".desktop-fusion-console"
)) {
  Assert-Contains $staticTest $needle "static test coverage"
}

foreach ($needle in @(
  'desktop-mascot-button',
  '/generate',
  'desktop prompt generation',
  'foreground fill',
  'expectedTitleHash, "desktop-title-hash"',
  'expectedToolProfile, "workbuddy"',
  'allowClipboardFallback, true',
  'noAutoSubmit, "true"'
)) {
  Assert-Contains $interactionTest $needle "interaction test coverage"
}

foreach ($needle in @(
  "P24 desktop mascot input fusion",
  "clickable mascot",
  "confirmForeground:true",
  "expectedTitleHash",
  "no-auto-submit",
  "metadata-only"
)) {
  Assert-Contains $doc $needle "M3 documentation"
}

foreach ($needle in @(
  "windowTitle",
  "foreground.rawTitle",
  "target.value",
  "candidate.value",
  "innerText",
  "textContentFromTarget"
)) {
  Assert-NotContains $app $needle "raw target text/title path in desktop shell"
}

$testOutput = ""
try {
  Push-Location $Root
  $testOutput = (& npm test --prefix apps/desktop-shell 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Add-Failure "npm test --prefix apps/desktop-shell failed with exit code $LASTEXITCODE"
  }
} catch {
  Add-Failure "npm test --prefix apps/desktop-shell threw: $($_.Exception.Message)"
} finally {
  Pop-Location
}

$result = [ordered]@{
  schemaVersion = "p24-desktop-mascot-input-fusion@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = ($failures.Count -eq 0)
  checks = [ordered]@{
    desktopFusionHtml = $html.Contains('id="desktop-fusion-console"')
    mascotButton = $html.Contains('id="desktop-mascot-button"')
    desktopGenerate = $app.Contains("generateDesktopPrompt") -and $app.Contains("/generate")
    foregroundFillGuard = $app.Contains("confirmForeground: true") -and $app.Contains("expectedTitleHash: readiness.titleHash") -and $app.Contains("expectedToolProfile: readiness.profile")
    noAutoSubmitEvidence = $app.Contains("noAutoSubmit")
    desktopTests = ($LASTEXITCODE -eq 0)
    documented = $doc.Contains("P24 desktop mascot input fusion")
  }
  failures = @($failures)
  testOutputTail = (($testOutput -split "`r?`n") | Select-Object -Last 12) -join "`n"
}

$reportDir = Split-Path -Parent $Report
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir | Out-Null
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $Report

if ($failures.Count -gt 0) {
  Write-Host "P24_DESKTOP_MASCOT_INPUT_FUSION_FAIL"
  $failures | ForEach-Object { Write-Host "- $_" }
  exit 1
}

Write-Host "P24_DESKTOP_MASCOT_INPUT_FUSION_PASS"
Write-Host "Report: $Report"
