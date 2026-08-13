param(
  [string]$Report = "research/p25-real-desktop-targets.latest.json",
  [ValidateSet("codex", "workbuddy", "trae")]
  [string[]]$Profiles = @("codex", "workbuddy", "trae"),
  [switch]$AllowForegroundWrite,
  [switch]$AllowClipboardFallback,
  [switch]$AllowTextPatternVerification,
  [string]$Text = "Smart Prompt P25 real desktop fill probe"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

function ConvertTo-RepoRelativePath {
  param([string]$PathValue)
  $full = [System.IO.Path]::GetFullPath($PathValue)
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = "$rootFull$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($rootFull.Length).Replace("\", "/")
  }
  return $full
}

function Get-JsonTextContainsSensitiveProbe {
  param([object]$JsonObject)
  if (-not $JsonObject) { return $false }
  $json = $JsonObject | ConvertTo-Json -Depth 16
  return $json.Contains($Text)
}

function Invoke-ProfileProbe {
  param([string]$Profile)

  $profileReport = Join-Path $Root ("research/p25-real-desktop-target-{0}.latest.json" -f $Profile)
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $ScriptDir "check-m3-real-desktop-tools.ps1"),
    "-Profiles", $Profile,
    "-AttachExistingWindow",
    "-AttachProfile", $Profile,
    "-Report", $profileReport
  )
  if ($AllowForegroundWrite) {
    $args += "-AllowForegroundWrite"
  }
  if ($AllowClipboardFallback) {
    $args += "-AllowClipboardFallback"
  }
  if ($AllowTextPatternVerification) {
    $args += "-AllowTextPatternVerification"
  }
  $args += @("-Text", $Text)

  $output = & powershell @args 2>&1
  $exitCode = $LASTEXITCODE
  $jsonObject = $null
  $parseError = ""
  if (Test-Path -LiteralPath $profileReport) {
    try {
      $jsonObject = Get-Content -Raw -Encoding UTF8 -LiteralPath $profileReport | ConvertFrom-Json
    } catch {
      $parseError = $_.Exception.Message
    }
  } else {
    $parseError = "profile report missing"
  }

  $writeSummary = if ($jsonObject -and $jsonObject.write -and $jsonObject.write.summary) {
    $jsonObject.write.summary
  } else {
    $null
  }
  $snapshotSummary = if ($jsonObject -and $jsonObject.snapshot) { $jsonObject.snapshot } else { $null }

  $foregroundDetected = [bool]($jsonObject -and $jsonObject.foreground -and $jsonObject.foreground.detectedToolProfile -eq $Profile)
  $selectionSource = if ($jsonObject -and $jsonObject.snapshot -and $jsonObject.snapshot.selectionSource) {
    $jsonObject.snapshot.selectionSource
  } elseif ($jsonObject -and $jsonObject.foreground -and $jsonObject.foreground.selectionSource) {
    $jsonObject.foreground.selectionSource
  } else {
    "foreground_window"
  }
  $strictForegroundDetected = [bool]($foregroundDetected -and $selectionSource -eq "foreground_window")
  $snapshotCandidateCount = if ($snapshotSummary -and $null -ne $snapshotSummary.candidateCount) { [int]$snapshotSummary.candidateCount } else { 0 }
  $safeCandidateCount = if ($snapshotSummary -and $null -ne $snapshotSummary.safeCandidateCount) { [int]$snapshotSummary.safeCandidateCount } else { 0 }
  $bestCandidateIndex = if ($snapshotSummary -and $null -ne $snapshotSummary.bestCandidateIndex) { [int]$snapshotSummary.bestCandidateIndex } else { -1 }

  return [pscustomobject]@{
    id = $Profile
    report = ConvertTo-RepoRelativePath $profileReport
    exitCode = $exitCode
    parseOk = [bool]($jsonObject -ne $null -and -not $parseError)
    parseError = $parseError
    windowFound = [bool]($jsonObject -and $jsonObject.attach -and $jsonObject.attach.windowFound)
    restoreWindow = [bool]($jsonObject -and $jsonObject.attach -and $jsonObject.attach.restoreWindow)
    setForeground = [bool]($jsonObject -and $jsonObject.attach -and $jsonObject.attach.setForeground)
    foregroundActivation = if ($jsonObject -and $jsonObject.attach -and $jsonObject.attach.foregroundActivation) {
      $jsonObject.attach.foregroundActivation
    } else {
      [pscustomobject]@{
        initialSetForeground = $false
        initialForeground = $false
        attachAttempted = $false
        attachCurrentToForeground = $false
        attachCurrentToTarget = $false
        attachBringToTop = $false
        attachSetForeground = $false
        attachForeground = $false
        altUnlockAttempted = $false
        altUnlockSent = $false
        altSetForeground = $false
        altForeground = $false
        switchAttempted = $false
        switchForeground = $false
        isForeground = $false
      }
    }
    cursorInsideTargetWindow = [bool]($jsonObject -and $jsonObject.attach -and $jsonObject.attach.cursorInsideTargetWindow)
    foregroundDetected = [bool]$foregroundDetected
    strictForegroundDetected = [bool]$strictForegroundDetected
    selectionSource = $selectionSource
    hasTargetForeground = [bool]($jsonObject -and $jsonObject.foreground -and $jsonObject.foreground.hasTargetForeground)
    detectedForegroundProfile = if ($jsonObject -and $jsonObject.foreground -and $jsonObject.foreground.detectedToolProfile) { $jsonObject.foreground.detectedToolProfile } else { "unknown" }
    foregroundTitleHash = if ($jsonObject -and $jsonObject.foreground -and $jsonObject.foreground.titleHash) { $jsonObject.foreground.titleHash } else { "" }
    foregroundTitleLength = if ($jsonObject -and $jsonObject.foreground -and $null -ne $jsonObject.foreground.titleLength) { [int]$jsonObject.foreground.titleLength } else { 0 }
    targetSnapshotApplies = [bool]$foregroundDetected
    targetCandidateCount = if ($foregroundDetected) { $snapshotCandidateCount } else { 0 }
    targetSafeCandidateCount = if ($foregroundDetected) { $safeCandidateCount } else { 0 }
    targetBestCandidateIndex = if ($foregroundDetected) { $bestCandidateIndex } else { -1 }
    writeAllowed = [bool]$AllowForegroundWrite
    writeAttempted = [bool]($jsonObject -and $jsonObject.write -and $jsonObject.write.attempted)
    writePass = [bool]($jsonObject -and $jsonObject.write -and $jsonObject.write.pass)
    writeVerified = [bool]($jsonObject -and $jsonObject.write -and $jsonObject.write.verified)
    writeReason = if ($jsonObject -and $jsonObject.write -and $jsonObject.write.reason) { $jsonObject.write.reason } else { "" }
    autoSubmit = if ($writeSummary -and $null -ne $writeSummary.autoSubmit) { [bool]$writeSummary.autoSubmit } else { $false }
    submitSignalCount = if ($writeSummary -and $null -ne $writeSummary.submitSignalCount) { [int]$writeSummary.submitSignalCount } else { 0 }
    privacyRedacted = [bool]($jsonObject -and $jsonObject.checks -and $jsonObject.checks.privacyRedacted)
    rawProbeTextLeaked = [bool](Get-JsonTextContainsSensitiveProbe -JsonObject $jsonObject)
    outputTail = (($output | Out-String) -split "`r?`n" | Select-Object -Last 8) -join "`n"
  }
}

$rows = @()
foreach ($profile in @($Profiles | Select-Object -Unique)) {
  $rows += Invoke-ProfileProbe -Profile $profile
}

$windowFoundCount = @($rows | Where-Object { $_.windowFound }).Count
$foregroundDetectedCount = @($rows | Where-Object { $_.foregroundDetected }).Count
$strictForegroundDetectedCount = @($rows | Where-Object { $_.strictForegroundDetected }).Count
$safeCandidateTargetCount = @($rows | Where-Object { $_.foregroundDetected -and $_.targetSafeCandidateCount -gt 0 -and $_.targetBestCandidateIndex -ge 0 }).Count
$writeAttemptedCount = @($rows | Where-Object { $_.writeAttempted }).Count
$writeVerifiedCount = @($rows | Where-Object { $_.writeVerified }).Count
$privacyOk = -not @($rows | Where-Object { -not $_.privacyRedacted -or $_.rawProbeTextLeaked -or $_.autoSubmit -or $_.submitSignalCount -ne 0 }).Count

$completionImpact = if ($writeVerifiedCount -eq $rows.Count -and $rows.Count -gt 0) {
  "all_target_writes_verified"
} elseif ($windowFoundCount -eq 0) {
  "target_windows_missing"
} elseif ($foregroundDetectedCount -eq 0) {
  "target_windows_not_foreground"
} elseif ($strictForegroundDetectedCount -eq 0) {
  "target_windows_detected_by_cursor_fallback"
} elseif ($safeCandidateTargetCount -eq 0) {
  "target_composer_safe_candidate_missing"
} elseif (-not $AllowForegroundWrite) {
  "real_write_not_requested"
} else {
  "target_write_not_verified"
}

$reportObject = [ordered]@{
  schemaVersion = "p25-real-desktop-targets@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]($privacyOk -and $rows.Count -gt 0)
  completionReady = [bool]($writeVerifiedCount -eq $rows.Count -and $strictForegroundDetectedCount -eq $rows.Count -and $rows.Count -gt 0 -and $privacyOk)
  completionImpact = $completionImpact
  requestedProfiles = @($rows | ForEach-Object { $_.id })
  allowForegroundWrite = [bool]$AllowForegroundWrite
  allowClipboardFallback = [bool]$AllowClipboardFallback
  allowTextPatternVerification = [bool]$AllowTextPatternVerification
  summary = [ordered]@{
    profileCount = [int]$rows.Count
    windowFoundCount = [int]$windowFoundCount
    foregroundDetectedCount = [int]$foregroundDetectedCount
    strictForegroundDetectedCount = [int]$strictForegroundDetectedCount
    safeCandidateTargetCount = [int]$safeCandidateTargetCount
    writeAttemptedCount = [int]$writeAttemptedCount
    writeVerifiedCount = [int]$writeVerifiedCount
    noAutoSubmit = [bool](-not @($rows | Where-Object { $_.autoSubmit -or $_.submitSignalCount -ne 0 }).Count)
    privacyOk = [bool]$privacyOk
  }
  targets = @($rows)
  privacy = [ordered]@{
    targetTitlesRedacted = $true
    targetInputsNotStored = $true
    promptTextNotStored = $true
    probeTextNotStored = [bool](-not @($rows | Where-Object { $_.rawProbeTextLeaked }).Count)
    verificationUsesLengthAndHash = $true
    noAutoSubmit = [bool](-not @($rows | Where-Object { $_.autoSubmit -or $_.submitSignalCount -ne 0 }).Count)
  }
}

$reportDir = Split-Path -Parent $Report
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$reportObject | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $Report
Write-Host "P25 real desktop targets report: $Report"
Write-Host ($reportObject | ConvertTo-Json -Depth 12)

if (-not $reportObject.pass) {
  exit 1
}
