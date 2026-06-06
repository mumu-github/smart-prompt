$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Push-Location (Join-Path $Root "apps/desktop-shell")
try {
  npm run runtime-test
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri runtime test failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
