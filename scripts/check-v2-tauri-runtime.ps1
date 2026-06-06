param(
  [string]$Report = "research/v2-tauri-runtime.latest.json"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null

Push-Location (Join-Path $Root "apps/desktop-shell")
try {
  $env:SMART_PROMPT_TAURI_RUNTIME_REPORT = $Report
  npm run runtime-test
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri runtime test failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item Env:\SMART_PROMPT_TAURI_RUNTIME_REPORT -ErrorAction SilentlyContinue
  Pop-Location
}
