$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Invoke-NpmTest($RelativePath, $Label) {
  Push-Location (Join-Path $Root $RelativePath)
  try {
    npm test
    if ($LASTEXITCODE -ne 0) {
      throw "$Label tests failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Invoke-NpmScript($RelativePath, $Script, $Label) {
  Push-Location (Join-Path $Root $RelativePath)
  try {
    npm run $Script
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Invoke-NpmTest "apps/local-service" "local-service"
Invoke-NpmTest "apps/desktop-shell" "desktop-shell"
Invoke-NpmTest "prototypes/browser-extension" "browser-extension"

Invoke-NpmScript "apps/desktop-shell" "build" "desktop-shell build"

& (Join-Path $Root "scripts/check-v4-installer-smoke.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "V4 installer smoke failed with exit code $LASTEXITCODE"
}

node (Join-Path $Root "scripts/check-v4-live-site-stability.js")
if ($LASTEXITCODE -ne 0) {
  throw "V4 live-site stability evidence failed with exit code $LASTEXITCODE"
}

node (Join-Path $Root "scripts/write-v4-release-manifest.js")
if ($LASTEXITCODE -ne 0) {
  throw "V4 critic failed: release manifest is not release-ready."
}

Write-Host "PASS: V4 critic passed."
