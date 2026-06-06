param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$failures = @()
function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

function Read-RequiredFile {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path $Path)) {
    Add-Failure "Missing required file: $Label"
    return ""
  }

  return Get-Content -Raw -Encoding UTF8 $Path
}

$requiredFiles = @(
  "docs/research-report.md",
  "docs/competitive-analysis.md",
  "docs/open-source-skills-analysis.md",
  "docs/prd.md",
  "assets/ui-ux/README.md"
)

$missing = @()
foreach ($file in $requiredFiles) {
  if (-not (Test-Path (Join-Path $Root $file))) {
    $missing += $file
  }
}

if ($missing.Count -gt 0) {
  Add-Failure ("Missing required files: " + ($missing -join ", "))
}

$researchText = Read-RequiredFile (Join-Path $Root "docs/research-report.md") "docs/research-report.md"
$competitiveText = Read-RequiredFile (Join-Path $Root "docs/competitive-analysis.md") "docs/competitive-analysis.md"
$openSourceText = Read-RequiredFile (Join-Path $Root "docs/open-source-skills-analysis.md") "docs/open-source-skills-analysis.md"
$prdText = Read-RequiredFile (Join-Path $Root "docs/prd.md") "docs/prd.md"

$allText = @($researchText, $competitiveText, $openSourceText, $prdText) -join "`n"
$linkCount = ([regex]::Matches($allText, "https?://")).Count
if ($linkCount -lt 18) {
  Add-Failure "Expected at least 18 source links across research docs; found $linkCount."
}

$unfinishedMarkers = @("STATUS_IN_PROGRESS", "TODO:", "TBD:", "PLACEHOLDER")
foreach ($marker in $unfinishedMarkers) {
  if ($allText.Contains($marker)) {
    Add-Failure "Unfinished marker remains: $marker"
  }
}

$prdSectionCount = ([regex]::Matches($prdText, "(?m)^##\s+")).Count
if ($prdSectionCount -lt 10) {
  Add-Failure "PRD expected at least 10 top-level sections; found $prdSectionCount."
}

$uiFiles = Get-ChildItem -Path (Join-Path $Root "assets/ui-ux") -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @(".png", ".jpg", ".jpeg", ".webp") }

if ($uiFiles.Count -lt 1) {
  Add-Failure "Expected at least one UI/UX image file in assets/ui-ux."
}

$builtInUiImage = Join-Path $Root "assets/ui-ux/prompt-copilot-uiux-builtin-exact-mascot-v2.png"
if (-not (Test-Path $builtInUiImage)) {
  Add-Failure "Expected built-in image_gen UI/UX concept image at assets/ui-ux/prompt-copilot-uiux-builtin-exact-mascot-v2.png."
}

$mascotFile = Join-Path $Root "assets/ui-ux/mascot-token-run.png"
if (-not (Test-Path $mascotFile)) {
  Add-Failure "Expected mascot reference image at assets/ui-ux/mascot-token-run.png."
}

$stateFiles = @(
  "assets/ui-ux/mascot-states/normal.png",
  "assets/ui-ux/mascot-states/resting.png",
  "assets/ui-ux/mascot-states/thinking.png",
  "assets/ui-ux/mascot-states/suggesting.png",
  "assets/ui-ux/mascot-states/success.png",
  "assets/ui-ux/mascot-states/clapping.png"
)
foreach ($stateFile in $stateFiles) {
  if (-not (Test-Path (Join-Path $Root $stateFile))) {
    Add-Failure "Expected mascot state asset at $stateFile."
  }
}

$animationFiles = @(
  "assets/ui-ux/mascot-animations/mascot-state-loop.mp4",
  "assets/ui-ux/mascot-animations/floating-prompt-assistant.mp4",
  "prototypes/remotion-mascot/src/Composition.tsx",
  "prototypes/remotion-mascot/src/Root.tsx"
)
foreach ($animationFile in $animationFiles) {
  if (-not (Test-Path (Join-Path $Root $animationFile))) {
    Add-Failure "Expected Remotion animation artifact at $animationFile."
  }
}

if (-not (Test-Path (Join-Path $Root ".git"))) {
  Add-Failure "Git repository is missing."
}

if ($failures.Count -gt 0) {
  Write-Error ("Completion audit failed:`n - " + ($failures -join "`n - "))
}

Write-Output "PASS: autoresearch artifacts meet local critic checks."
