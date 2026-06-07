param(
  [string]$Report = "research/m3-installed-sidecar-desktop-input.latest.json",
  [switch]$SkipBuild,
  [int]$RemotePort = 9241,
  [int]$ServicePort = 17461
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$RawReport = ".runtime/m3-installed-v4-installer-smoke.raw.json"

function ConvertTo-RelativePath([string]$PathValue) {
  if (-not $PathValue) { return "" }
  $full = [IO.Path]::GetFullPath($PathValue)
  $base = [IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
  if ($full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($base.Length).TrimStart("\", "/").Replace("\", "/")
  }
  return $full.Replace("\", "/")
}

function Write-ReportObject([object]$Value) {
  $reportPath = if ([IO.Path]::IsPathRooted($Report)) { $Report } else { Join-Path $Root $Report }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null
  $json = $Value | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($reportPath, "$json`n", [Text.UTF8Encoding]::new($false))
  Write-Host "M3 installed sidecar desktop input report: $reportPath"
  Write-Output $json
}

$reportObject = [ordered]@{
  schemaVersion = "m3-installed-sidecar-desktop-input@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = $false
  remotePort = $RemotePort
  servicePort = $ServicePort
  rawInstallerSmokeReport = $RawReport
  checks = [ordered]@{
    desktopShellBuilt = $false
    installerSmokePass = $false
    bundledNativeSidecar = $false
    bundledDesktopInputProbe = $false
    bundledDesktopFillProbe = $false
    installedAppStartedSidecar = $false
    installedServiceHealth = $false
    desktopSnapshotFromInstalledSidecar = $false
    desktopSnapshotSelfTestPass = $false
    desktopSnapshotToolProfiles = $false
    desktopSnapshotPrivacyRedacted = $false
    desktopFillFromInstalledSidecar = $false
    desktopFillSelfTestPass = $false
    desktopFillToolProfiles = $false
    desktopFillPrivacyRedacted = $false
    installedAppStoppedSidecar = $false
  }
}

try {
  if (-not $SkipBuild) {
    Push-Location (Join-Path $Root "apps/desktop-shell")
    try {
      npm run build
      if ($LASTEXITCODE -ne 0) {
        throw "desktop-shell npm run build failed with exit code $LASTEXITCODE"
      }
      $reportObject.checks.desktopShellBuilt = $true
    } finally {
      Pop-Location
    }
  } else {
    $reportObject.checks.desktopShellBuilt = $true
  }

  powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-v4-installer-smoke.ps1") `
    -Report $RawReport `
    -RemotePort $RemotePort `
    -ServicePort $ServicePort
  if ($LASTEXITCODE -ne 0) {
    throw "V4 installer smoke failed with exit code $LASTEXITCODE"
  }

  $rawPath = Join-Path $Root $RawReport
  $raw = Get-Content -Raw -Encoding UTF8 $rawPath | ConvertFrom-Json
  $runtime = $raw.installedRuntime
  $snapshot = $runtime.desktopInputSnapshot
  $fill = $runtime.desktopFill

  $reportObject.installer = $raw.installer
  $reportObject.installedExeName = $raw.installedExeName
  $reportObject.bundledSidecarExecutable = $runtime.bundledSidecarExecutable
  $reportObject.bundledDesktopInputProbe = $runtime.bundledDesktopInputProbe
  $reportObject.bundledDesktopFillProbe = $runtime.bundledDesktopFillProbe
  $reportObject.desktopInputSnapshot = $snapshot
  $reportObject.desktopFill = $fill
  $reportObject.checks.installerSmokePass = [bool]$raw.pass
  $reportObject.checks.bundledNativeSidecar = [bool]$runtime.checks.bundledNativeSidecar
  $reportObject.checks.bundledDesktopInputProbe = [bool]$runtime.checks.bundledDesktopInputProbe
  $reportObject.checks.bundledDesktopFillProbe = [bool]$runtime.checks.bundledDesktopFillProbe
  $reportObject.checks.installedAppStartedSidecar = [bool]$runtime.checks.localServiceStartedFromInstalledApp
  $reportObject.checks.installedServiceHealth = [bool]$runtime.checks.serviceHealthFromInstalledApp
  $reportObject.checks.desktopSnapshotFromInstalledSidecar = [bool]$runtime.checks.desktopSnapshotFromInstalledSidecar
  $reportObject.checks.desktopSnapshotSelfTestPass = [bool]$runtime.checks.desktopSnapshotSelfTestPass
  $reportObject.checks.desktopSnapshotToolProfiles = [bool]$runtime.checks.desktopSnapshotToolProfiles
  $reportObject.checks.desktopSnapshotPrivacyRedacted = [bool]$runtime.checks.desktopSnapshotPrivacyRedacted
  $reportObject.checks.desktopFillFromInstalledSidecar = [bool]$runtime.checks.desktopFillFromInstalledSidecar
  $reportObject.checks.desktopFillSelfTestPass = [bool]$runtime.checks.desktopFillSelfTestPass
  $reportObject.checks.desktopFillToolProfiles = [bool]$runtime.checks.desktopFillToolProfiles
  $reportObject.checks.desktopFillPrivacyRedacted = [bool]$runtime.checks.desktopFillPrivacyRedacted
  $reportObject.checks.installedAppStoppedSidecar = [bool]$runtime.checks.localServiceStoppedFromInstalledApp
  $failedChecks = @()
  foreach ($entry in $reportObject.checks.GetEnumerator()) {
    if (-not [bool]$entry.Value) {
      $failedChecks += $entry.Key
    }
  }
  $reportObject.failedChecks = $failedChecks
  $reportObject.pass = $failedChecks.Count -eq 0
  Write-ReportObject $reportObject
} catch {
  $reportObject.error = $_.Exception.Message
  Write-ReportObject $reportObject
  throw
}

if (-not $reportObject.pass) {
  throw "M3 installed sidecar desktop input report did not pass."
}
