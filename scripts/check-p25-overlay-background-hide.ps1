param(
  [string]$Report = "research/p25-overlay-background-hide.latest.json",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$RuntimeReadinessReport = "research/p25-runtime-readiness.latest.json",
  [string]$OverlayVisualAttachReport = "research/p25-overlay-background-hide-attach.latest.json",
  [int]$TimeoutSeconds = 2,
  [switch]$AllowFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

function Resolve-RepoPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

function ConvertTo-RepoRelativePath {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return "" }
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = "$rootFull$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($rootFull.Length).Replace("\", "/")
  }
  return $full.Replace("\", "/")
}

function Read-JsonReport {
  param([string]$PathValue)
  $resolved = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $resolved)) { return $null }
  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $resolved | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Run-Step {
  param([scriptblock]$Block)
  & $Block | Out-Host
  return $LASTEXITCODE
}

$resolvedReport = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $resolvedReport
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$runtimeScript = Resolve-RepoPath "scripts/check-p25-runtime-readiness.ps1"
$visualScript = Resolve-RepoPath "scripts/check-p25-visual.ps1"

$stepExitCodes = [ordered]@{}
$stepExitCodes.runtimeReadiness = Run-Step {
  powershell -NoProfile -ExecutionPolicy Bypass -File $runtimeScript `
    -TransparentReleaseExe $TransparentReleaseExe `
    -Report $RuntimeReadinessReport `
    -AllowFailure
}
$stepExitCodes.overlayAttach = Run-Step {
  powershell -NoProfile -ExecutionPolicy Bypass -File $visualScript `
    -Mode OverlayWindowVisualAttach `
    -Report $OverlayVisualAttachReport `
    -TimeoutSeconds $TimeoutSeconds `
    -AllowFailure
}

$runtimeReadiness = Read-JsonReport $RuntimeReadinessReport
$overlayAttach = Read-JsonReport $OverlayVisualAttachReport

$runtimeReady = [bool]($runtimeReadiness -and $runtimeReadiness.completionReady)
$windowFound = [bool]($overlayAttach -and $overlayAttach.checks -and $overlayAttach.checks.overlayWindowFound)
$windowHidden = [bool]($overlayAttach -and $overlayAttach.checks -and -not $overlayAttach.checks.overlayWindowVisible)
$noActivateStyle = [bool]($overlayAttach -and $overlayAttach.checks -and $overlayAttach.checks.noActivateStyle)
$overlayWindowNotVisibleImpact = [bool]($overlayAttach -and [string]$overlayAttach.completionImpact -eq "overlay_window_not_visible")
$safetyOk = [bool](
  $overlayAttach -and
  $overlayAttach.safety -and
  $overlayAttach.safety.attachOnly -and
  -not $overlayAttach.safety.processStartAttempted -and
  -not $overlayAttach.safety.stopAttempted -and
  -not $overlayAttach.safety.killAttempted -and
  -not $overlayAttach.safety.replaceAttempted -and
  -not $overlayAttach.safety.realOverlayClickAttempted -and
  -not $overlayAttach.safety.targetWriteAttempted -and
  -not $overlayAttach.safety.screenshotWriteAttempted
)
$privacyOk = [bool](
  $runtimeReadiness -and
  $runtimeReadiness.privacy -and
  $runtimeReadiness.privacy.noPromptTextRead -and
  $runtimeReadiness.privacy.noTargetInputRead -and
  $overlayAttach -and
  $overlayAttach.privacy -and
  $overlayAttach.privacy.noPromptTextRead -and
  $overlayAttach.privacy.noTargetInputRead -and
  -not $overlayAttach.privacy.rawDesktopPixelsPersisted
)

$pass = [bool](
  $runtimeReady -and
  $windowFound -and
  $windowHidden -and
  $noActivateStyle -and
  $overlayWindowNotVisibleImpact -and
  $safetyOk -and
  $privacyOk
)

$completionImpact = if ($pass) {
  "overlay_hidden_when_target_backgrounded"
} elseif (-not $runtimeReady) {
  "runtime_not_ready"
} elseif (-not $windowFound) {
  "overlay_window_missing"
} elseif (-not $windowHidden) {
  "overlay_window_still_visible"
} elseif (-not $noActivateStyle) {
  "overlay_no_activate_missing"
} elseif (-not $safetyOk) {
  "safety_boundary_failed"
} elseif (-not $privacyOk) {
  "privacy_boundary_failed"
} else {
  "background_hide_evidence_incomplete"
}

$reportObject = [ordered]@{
  schemaVersion = "p25-overlay-background-hide@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$pass
  completionReady = [bool]$pass
  completionImpact = [string]$completionImpact
  steps = $stepExitCodes
  runtimeReadiness = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $RuntimeReadinessReport)
    completionReady = [bool]$runtimeReady
    processCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.processCount } else { 0 }
    matchingProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.matchingProcessCount } else { 0 }
    overlayWindowCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.overlayWindowCount } else { 0 }
    overlayMatchesDesktopShellProcess = [bool]($runtimeReadiness -and $runtimeReadiness.checks -and $runtimeReadiness.checks.overlayMatchesDesktopShellProcess)
  }
  overlayAttach = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayVisualAttachReport)
    completionImpact = if ($overlayAttach) { [string]$overlayAttach.completionImpact } else { "" }
    windowCount = if ($overlayAttach) { [int]$overlayAttach.windowCount } else { 0 }
    windowFound = [bool]$windowFound
    windowHidden = [bool]$windowHidden
    noActivateStyle = [bool]$noActivateStyle
    screenshotSaved = [bool]($overlayAttach -and $overlayAttach.checks -and $overlayAttach.checks.screenshotSaved)
  }
  safety = [ordered]@{
    verifiesBackgroundHideOnly = $true
    processStartAttempted = $false
    stopAttempted = $false
    killAttempted = $false
    replaceAttempted = $false
    realOverlayClickAttempted = $false
    targetWriteAttempted = $false
    screenshotWriteAttempted = $false
  }
  privacy = [ordered]@{
    noPromptTextRead = $true
    noTargetInputRead = $true
    noRawTitlesRead = $true
    rawUiaNamesNotRead = $true
    clipboardTextNotRead = $true
    rawDesktopPixelsPersisted = $false
    onlyMetadataStored = $true
  }
}

$json = $reportObject | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($resolvedReport, "$json`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "P25 overlay background hide report: $resolvedReport"
Write-Host ($reportObject | ConvertTo-Json -Depth 12)

if (-not $AllowFailure -and -not $pass) {
  exit 1
}
