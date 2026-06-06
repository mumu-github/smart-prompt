$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ExtensionRoot = Join-Path $Root "prototypes/browser-extension"
$failures = @()

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

$requiredFiles = @(
  "manifest.json",
  "src/prompt-engine.js",
  "src/content.js",
  "src/content.css",
  "options/options.html",
  "options/options.js",
  "popup/popup.html",
  "popup/popup.js",
  "demo/demo.html",
  "tests/prompt-engine.test.js",
  "tests/manifest.test.js",
  "assets/mascot-states/normal.png",
  "assets/mascot-states/resting.png",
  "assets/mascot-states/thinking.png",
  "assets/mascot-states/suggesting.png",
  "assets/mascot-states/success.png",
  "assets/mascot-states/clapping.png"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path (Join-Path $ExtensionRoot $file))) {
    Add-Failure "Missing browser extension file: $file"
  }
}

if (Test-Path (Join-Path $ExtensionRoot "manifest.json")) {
  $manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $ExtensionRoot "manifest.json") | ConvertFrom-Json
  if ($manifest.manifest_version -ne 3) {
    Add-Failure "manifest.json must use manifest_version 3."
  }
  if (-not $manifest.content_scripts) {
    Add-Failure "manifest.json must declare content scripts."
  }
  if (-not $manifest.options_page) {
    Add-Failure "manifest.json must declare options_page."
  }
}

Push-Location $ExtensionRoot
try {
  npm test
} catch {
  Add-Failure "Browser extension npm test failed."
} finally {
  Pop-Location
}

if ($failures.Count -gt 0) {
  Write-Error ("Browser extension audit failed:`n - " + ($failures -join "`n - "))
}

Write-Output "PASS: browser extension MVP checks passed."
