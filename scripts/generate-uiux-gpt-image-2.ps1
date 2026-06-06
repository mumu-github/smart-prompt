param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$imageGen = Join-Path $codexHome "skills\.system\imagegen\scripts\image_gen.py"
$promptFile = Join-Path $root "assets\ui-ux\gpt-image-2-uiux.prompt.txt"
$mascotFile = Join-Path $root "assets\ui-ux\mascot-token-run.png"
$outFile = Join-Path $root "assets\ui-ux\prompt-copilot-uiux-gpt-image-2.png"

if (-not $env:OPENAI_API_KEY) {
  $userKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")
  if ($userKey) {
    $env:OPENAI_API_KEY = $userKey
  }
}

if (-not (Test-Path $imageGen)) {
  throw "image_gen.py not found at $imageGen"
}

if (-not (Test-Path $promptFile)) {
  throw "Prompt file not found at $promptFile"
}

if (-not (Test-Path $mascotFile)) {
  throw "Mascot reference image not found at $mascotFile"
}

$imageGenArgs = @(
  $imageGen,
  "edit",
  "--model", "gpt-image-2",
  "--image", $mascotFile,
  "--prompt-file", $promptFile,
  "--quality", "high",
  "--size", "2048x1152",
  "--out", $outFile
)

if ($DryRun) {
  $imageGenArgs += "--dry-run"
}

if ($Force) {
  $imageGenArgs += "--force"
}

$pythonHasOpenAI = $false
try {
  python -c "import openai" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $pythonHasOpenAI = $true
  }
} catch {
  $pythonHasOpenAI = $false
}

if ($pythonHasOpenAI) {
  python @imageGenArgs
} else {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if (-not $uv) {
    throw "The active Python environment does not have the openai SDK, and uv is not available to run a temporary SDK environment."
  }

  uv run --with openai python @imageGenArgs
}
