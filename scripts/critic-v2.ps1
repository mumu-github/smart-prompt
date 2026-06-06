param(
  [switch]$RequireRuntimeEvidence
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$failures = @()

$cargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

$requiredFiles = @(
  "packages/shared/smart-prompt-core.js",
  "packages/shared/llm-gateway.js",
  "apps/local-service/src/server.js",
  "apps/local-service/src/store.js",
  "apps/local-service/src/skill-library.js",
  "apps/local-service/tests/local-service.test.js",
  "prototypes/browser-extension/src/site-adapters.js",
  "prototypes/browser-extension/src/local-service-client.js",
  "prototypes/browser-extension/tests/site-adapters.test.js",
  "apps/desktop-shell/index.html",
  "apps/desktop-shell/src/app.js",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/src-tauri/src/main.rs",
  "apps/desktop-shell/tests/desktop-shell.test.js",
  "research/v2-implementation-rubric.md",
  "research/v2-verification.md"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path (Join-Path $Root $file))) {
    Add-Failure "Missing V2 file: $file"
  }
}

$commands = @(
  @{ Dir = "apps/local-service"; Cmd = "npm test"; Label = "local service tests" },
  @{ Dir = "prototypes/browser-extension"; Cmd = "npm test"; Label = "browser extension tests" },
  @{ Dir = "apps/desktop-shell"; Cmd = "npm test"; Label = "desktop shell tests" },
  @{ Dir = "apps/desktop-shell"; Cmd = "cargo check --manifest-path src-tauri\Cargo.toml"; Label = "Tauri cargo check" }
)

foreach ($command in $commands) {
  Push-Location (Join-Path $Root $command.Dir)
  try {
    Invoke-Expression $command.Cmd
  } catch {
    Add-Failure ("Failed " + $command.Label)
  } finally {
    Pop-Location
  }
}

$contentPath = Join-Path $Root "prototypes/browser-extension/src/content.js"
if (Test-Path $contentPath) {
  $content = Get-Content -Raw -Encoding UTF8 $contentPath
  if ($content -match "submit\s*\(" -or $content -match "KeyboardEvent\([^)]*Enter") {
    Add-Failure "Browser extension appears to auto-submit or press Enter."
  }
}

$verification = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/v2-verification.md")
if ($RequireRuntimeEvidence) {
  $markers = @(
    "LIVE_5_SITES_PASS",
    "INSERT_CHATGPT_PASS",
    "INSERT_CLAUDE_PASS",
    "INSERT_GEMINI_PASS",
    "TAURI_START_PASS",
    "GLOBAL_SHORTCUT_PASS",
    "LOCAL_SERVICE_BRIDGE_PASS"
  )
  foreach ($marker in $markers) {
    if (-not $verification.Contains($marker)) {
      Add-Failure "Missing runtime evidence marker: $marker"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Error ("V2 audit failed:`n - " + ($failures -join "`n - "))
}

Write-Output "PASS: V2 automated checks passed."
if (-not $RequireRuntimeEvidence) {
  Write-Output "NOTE: runtime evidence was not required for this run; do not mark V2 complete without live-site and Tauri runtime verification."
}
