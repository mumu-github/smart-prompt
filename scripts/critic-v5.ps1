$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Invoke-RepoCommand([string]$RelativePath, [string]$CommandText, [string]$Label) {
  Push-Location (Join-Path $Root $RelativePath)
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -Command $CommandText
    if ($LASTEXITCODE -ne 0) {
      throw "$Label failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Invoke-RepoCommand "apps/local-service" "npm test" "local-service tests"
Invoke-RepoCommand "apps/desktop-shell" "npm test" "desktop-shell tests"
Invoke-RepoCommand "prototypes/browser-extension" "npm test" "browser-extension tests"

node (Join-Path $Root "scripts/write-v5-beta-manifest.js")
if ($LASTEXITCODE -ne 0) {
  throw "V5 critic failed: beta release and pilot-loop manifest is not release-ready."
}

Write-Host "PASS: V5 critic passed."
