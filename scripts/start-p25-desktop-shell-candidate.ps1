param(
  [string]$Report = "research/p25-desktop-shell-start.latest.json",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$RuntimeReadinessReport = "research/p25-runtime-readiness.latest.json",
  [string]$ProcessName = "smart-prompt-desktop",
  [int]$TimeoutSeconds = 20,
  [switch]$AllowStartDesktopShell,
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
  $root = [System.IO.Path]::GetFullPath($Root)
  if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $root = "$root$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($root.Length).Replace("\", "/")
  }
  return $full.Replace("\", "/")
}

function Get-FileSha256Prefix {
  param([string]$PathValue, [int]$PrefixLength = 16)
  if (-not (Test-Path -LiteralPath $PathValue)) { return "" }
  try {
    $hash = Get-FileHash -LiteralPath $PathValue -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant().Substring(0, [Math]::Min($PrefixLength, $hash.Hash.Length))
  } catch {
    return ""
  }
}

function Get-FileLastWriteUtc {
  param([string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) { return $null }
  return (Get-Item -LiteralPath $PathValue).LastWriteTimeUtc
}

function Get-DesktopShellProcesses {
  param([string]$Name)
  $query = "name='$Name.exe'"
  @(Get-CimInstance Win32_Process -Filter $query -ErrorAction SilentlyContinue | ForEach-Object {
    $path = if ($_.ExecutablePath) { [string]$_.ExecutablePath } else { "" }
    [pscustomobject]@{
      processId = [int]$_.ProcessId
      executablePath = if ($path) { ConvertTo-RepoRelativePath $path } else { "" }
      executablePathKnown = [bool]$path
      absolutePath = $path
    }
  })
}

function Write-LaunchReport {
  param([object]$ReportObject, [string]$PathValue)
  $resolved = Resolve-RepoPath $PathValue
  $dir = Split-Path -Parent $resolved
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $ReportObject | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $resolved
  Write-Host "P25 desktop shell start report: $resolved"
  Write-Host ($ReportObject | ConvertTo-Json -Depth 12)
}

$resolvedExe = Resolve-RepoPath $TransparentReleaseExe
$resolvedRuntimeReport = Resolve-RepoPath $RuntimeReadinessReport
$exePresent = Test-Path -LiteralPath $resolvedExe
$beforeRows = @(Get-DesktopShellProcesses -Name $ProcessName)
$existingProcessCount = $beforeRows.Count
$launchedProcess = $null
$startError = $null
$startAttempted = $false
$status = "not_started"

if ($existingProcessCount -gt 0) {
  $status = "existing_process_found"
} elseif (-not $exePresent) {
  $status = "candidate_missing"
} elseif (-not $AllowStartDesktopShell) {
  $status = "start_not_allowed"
} else {
  try {
    $startAttempted = $true
    $launchedProcess = Start-Process -FilePath $resolvedExe -PassThru -WindowStyle Hidden
    $status = "start_attempted"
  } catch {
    $startError = $_.Exception.Message
    $status = "start_failed"
  }
}

if ($startAttempted) {
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
  do {
    Start-Sleep -Milliseconds 250
    $afterRows = @(Get-DesktopShellProcesses -Name $ProcessName)
    if ($afterRows.Count -gt 0) { break }
  } while ((Get-Date) -lt $deadline)
} else {
  $afterRows = @(Get-DesktopShellProcesses -Name $ProcessName)
}

$readinessExitCode = $null
$readinessRan = $false
$runtimeReadinessScript = Resolve-RepoPath "scripts/check-p25-runtime-readiness.ps1"
if (Test-Path -LiteralPath $runtimeReadinessScript) {
  $readinessRan = $true
  & powershell -NoProfile -ExecutionPolicy Bypass -File $runtimeReadinessScript `
    -TransparentReleaseExe $TransparentReleaseExe `
    -Report $RuntimeReadinessReport `
    -ProcessName $ProcessName `
    -AllowFailure | Out-Host
  $readinessExitCode = $LASTEXITCODE
}

$runtimeReadiness = $null
if (Test-Path -LiteralPath $resolvedRuntimeReport) {
  try {
    $runtimeReadiness = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedRuntimeReport | ConvertFrom-Json
  } catch {
    $runtimeReadiness = $null
  }
}

$completionReady = [bool]($runtimeReadiness -and $runtimeReadiness.completionReady)
$pass = [bool]($completionReady)
$completionImpact = if ($completionReady) {
  "desktop_shell_runtime_ready"
} elseif ($status -eq "start_not_allowed") {
  "start_not_allowed"
} elseif ($existingProcessCount -gt 0) {
  "existing_process_requires_manual_resolution"
} elseif (-not $exePresent) {
  "candidate_missing"
} elseif ($startError) {
  "start_failed"
} else {
  "runtime_readiness_missing"
}
$startSkippedReason = if ($existingProcessCount -gt 0) {
  "existing_process_found"
} elseif (-not $exePresent) {
  "candidate_missing"
} elseif (-not $AllowStartDesktopShell) {
  "start_not_allowed"
} elseif ($startError) {
  "start_failed"
} elseif (-not $startAttempted) {
  "not_started"
} else {
  ""
}
$candidateReady = [bool](
  $runtimeReadiness -and
  $runtimeReadiness.checks -and
  $runtimeReadiness.checks.candidateReady
)
$runtimeProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.processCount } else { 0 }
$runtimeMatchingProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.matchingProcessCount } else { 0 }

$reportObject = [ordered]@{
  schemaVersion = "p25-desktop-shell-start@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$pass
  completionReady = [bool]$completionReady
  completionImpact = [string]$completionImpact
  status = [string]$status
  candidate = [ordered]@{
    path = ConvertTo-RepoRelativePath $resolvedExe
    present = [bool]$exePresent
    sizeBytes = if ($exePresent) { [long](Get-Item -LiteralPath $resolvedExe).Length } else { $null }
    lastWriteUtc = if ($exePresent) { (Get-FileLastWriteUtc $resolvedExe).ToString("o") } else { $null }
    sha256Prefix = if ($exePresent) { Get-FileSha256Prefix $resolvedExe } else { "" }
  }
  process = [ordered]@{
    processName = "$ProcessName.exe"
    beforeCount = [int]$existingProcessCount
    afterCount = [int]@($afterRows).Count
    launchedProcessId = if ($launchedProcess) { [int]$launchedProcess.Id } else { $null }
    startError = $startError
    before = @($beforeRows | ForEach-Object {
      [ordered]@{
        processId = [int]$_.processId
        executablePath = [string]$_.executablePath
        executablePathKnown = [bool]$_.executablePathKnown
      }
    })
    after = @($afterRows | ForEach-Object {
      [ordered]@{
        processId = [int]$_.processId
        executablePath = [string]$_.executablePath
        executablePathKnown = [bool]$_.executablePathKnown
      }
    })
  }
  diagnostics = [ordered]@{
    candidateReady = [bool]$candidateReady
    existingProcessBlocksStart = [bool]($existingProcessCount -gt 0 -and -not $completionReady)
    safeToStartWithoutStoppingExisting = [bool]($existingProcessCount -eq 0 -and $exePresent)
    startSkippedReason = [string]$startSkippedReason
    startAttemptedOnlyWithExplicitAllow = [bool]((-not $startAttempted) -or $AllowStartDesktopShell)
    runtimeProcessCount = [int]$runtimeProcessCount
    runtimeMatchingProcessCount = [int]$runtimeMatchingProcessCount
    runtimeMatchesCandidate = [bool]($runtimeMatchingProcessCount -gt 0)
    nextAction = if ($completionReady) {
      "run_visual_runtime_attach"
    } elseif (-not $AllowStartDesktopShell) {
      "explicitly_allow_start_to_verify_real_overlay"
    } elseif ($existingProcessCount -gt 0) {
      "resolve_existing_desktop_shell_process_before_starting_candidate"
    } elseif ($startError) {
      "inspect_start_error"
    } else {
      "inspect_runtime_readiness_report"
    }
  }
  runtimeReadiness = [ordered]@{
    report = ConvertTo-RepoRelativePath $resolvedRuntimeReport
    ran = [bool]$readinessRan
    exitCode = $readinessExitCode
    completionReady = [bool]($runtimeReadiness -and $runtimeReadiness.completionReady)
    processCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.processCount } else { 0 }
    matchingProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.matchingProcessCount } else { 0 }
  }
  safety = [ordered]@{
    startRequiresExplicitAllow = $true
    startAllowed = [bool]$AllowStartDesktopShell
    startAttempted = [bool]$startAttempted
    stopAttempted = $false
    killAttempted = $false
    replaceAttempted = $false
    realOverlayClickAttempted = $false
    writeAttempted = $false
  }
  privacy = [ordered]@{
    noPromptTextRead = $true
    noTargetInputRead = $true
    noRawTitlesRead = $true
    rawUiaNamesNotRead = $true
    clipboardTextNotRead = $true
    onlyMetadataStored = $true
  }
}

Write-LaunchReport -ReportObject $reportObject -PathValue $Report

if (-not $AllowFailure -and -not $pass) {
  exit 1
}
