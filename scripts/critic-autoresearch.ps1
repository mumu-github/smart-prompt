param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

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
  Write-Error ("Missing required files: " + ($missing -join ", "))
}

$researchText = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "docs/research-report.md")
$competitiveText = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "docs/competitive-analysis.md")
$openSourceText = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "docs/open-source-skills-analysis.md")
$prdText = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "docs/prd.md")

$allText = @($researchText, $competitiveText, $openSourceText, $prdText) -join "`n"
$linkCount = ([regex]::Matches($allText, "https?://")).Count
if ($linkCount -lt 18) {
  Write-Error "Expected at least 18 source links across research docs; found $linkCount."
}

$unfinishedMarkers = @("STATUS_IN_PROGRESS", "TODO:", "TBD:", "PLACEHOLDER")
foreach ($marker in $unfinishedMarkers) {
  if ($allText.Contains($marker)) {
    Write-Error "Unfinished marker remains: $marker"
  }
}

$prdSectionCount = ([regex]::Matches($prdText, "(?m)^##\s+")).Count
if ($prdSectionCount -lt 10) {
  Write-Error "PRD expected at least 10 top-level sections; found $prdSectionCount."
}

$uiFiles = Get-ChildItem -Path (Join-Path $Root "assets/ui-ux") -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @(".png", ".jpg", ".jpeg", ".webp") }

if ($uiFiles.Count -lt 1) {
  Write-Error "Expected at least one UI/UX image file in assets/ui-ux."
}

$gptImage2Prompt = Join-Path $Root "assets/ui-ux/gpt-image-2-uiux.prompt.txt"
if (-not (Test-Path $gptImage2Prompt)) {
  Write-Error "Expected gpt-image-2 prompt file at assets/ui-ux/gpt-image-2-uiux.prompt.txt."
}

$mascotFile = Join-Path $Root "assets/ui-ux/mascot-token-run.png"
if (-not (Test-Path $mascotFile)) {
  Write-Error "Expected mascot reference image at assets/ui-ux/mascot-token-run.png."
}

$gptImage2Script = Join-Path $Root "scripts/generate-uiux-gpt-image-2.ps1"
if (-not (Test-Path $gptImage2Script)) {
  Write-Error "Expected gpt-image-2 generation script at scripts/generate-uiux-gpt-image-2.ps1."
}

$gptImage2Image = Join-Path $Root "assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png"
if (-not (Test-Path $gptImage2Image)) {
  Write-Error "Expected UI/UX image generated through the explicit gpt-image-2 CLI/API path at assets/ui-ux/prompt-copilot-uiux-gpt-image-2.png."
}

if (-not (Test-Path (Join-Path $Root ".git"))) {
  Write-Error "Git repository is missing."
}

Write-Output "PASS: autoresearch artifacts meet local critic checks."
