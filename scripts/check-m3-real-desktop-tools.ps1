param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [ValidateSet("codex", "claude-code", "hermes")]
  [string[]]$Profiles = @("codex", "claude-code", "hermes"),
  [switch]$AllowForegroundWrite,
  [switch]$AllowClipboardFallback,
  [string]$ExpectedTitleHash = "",
  [string]$ExpectedToolProfile = "",
  [int]$CandidateIndex = 0,
  [string]$Text = "Smart Prompt M3 real foreground desktop fill probe"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-real-desktop-tools.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

$SupportedProfiles = @("codex", "claude-code", "hermes")
$RequestedProfiles = @($Profiles | Select-Object -Unique)
if ($RequestedProfiles.Count -eq 0) {
  $RequestedProfiles = $SupportedProfiles
}

function Invoke-JsonProbe {
  param(
    [string]$Path,
    [string[]]$Arguments
  )

  $commandArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Path)
  $commandArgs += $Arguments
  $output = & powershell @commandArgs
  $exitCode = $LASTEXITCODE
  $jsonText = ($output | Where-Object { $null -ne $_ }) -join "`n"
  $json = $null
  $parseOk = $false
  $parseError = ""
  try {
    if ($jsonText.Trim().Length -gt 0) {
      $json = $jsonText | ConvertFrom-Json
      $parseOk = $true
    }
  } catch {
    $parseError = $_.Exception.Message
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    parseOk = [bool]$parseOk
    parseError = $parseError
    json = $json
  }
}

function New-CoverageRow {
  param(
    [string]$Profile,
    [string]$DetectedProfile,
    [int]$CandidateCount,
    [bool]$WriteValidated
  )

  return [pscustomobject]@{
    id = $Profile
    status = if ($DetectedProfile -eq $Profile) { "foreground_detected" } else { "not_foreground" }
    foregroundDetected = [bool]($DetectedProfile -eq $Profile)
    snapshotCandidateCount = if ($DetectedProfile -eq $Profile) { $CandidateCount } else { 0 }
    realWindowWriteValidated = [bool]$WriteValidated
  }
}

$inputProbe = Invoke-JsonProbe -Path (Join-Path $ScriptDir "check-m3-desktop-input.ps1") -Arguments @("-JsonOnly")
$snapshot = $inputProbe.json
$snapshotOk = [bool]($inputProbe.parseOk -and $snapshot -and $snapshot.schemaVersion -eq "m3-windows-uia@1" -and $snapshot.probeOk)
$detectedToolProfile = "unknown"
$candidateCount = 0
$foreground = [pscustomobject]@{
  processName = ""
  pidPresent = $false
  titleLength = 0
  titleHash = ""
  detectedToolProfile = "unknown"
  hasTargetForeground = $false
}

if ($snapshot -and $snapshot.foreground) {
  $detectedToolProfile = if ($snapshot.foreground.detectedToolProfile) { $snapshot.foreground.detectedToolProfile } else { "unknown" }
  if ($snapshot.summary -and $null -ne $snapshot.summary.candidateCount) {
    $candidateCount = [int]$snapshot.summary.candidateCount
  } elseif ($snapshot.candidates) {
    $candidateCount = @($snapshot.candidates).Count
  }
  $foreground = [pscustomobject]@{
    processName = $snapshot.foreground.processName
    pidPresent = [bool]$snapshot.foreground.pidPresent
    titleLength = [int]$snapshot.foreground.titleLength
    titleHash = $snapshot.foreground.titleHash
    detectedToolProfile = $detectedToolProfile
    hasTargetForeground = [bool]($RequestedProfiles -contains $detectedToolProfile)
  }
}

$write = [pscustomobject]@{
  allowed = [bool]$AllowForegroundWrite
  attempted = $false
  pass = $false
  verified = $false
  strategy = ""
  clipboardFallbackAllowed = [bool]$AllowClipboardFallback
  clipboardFallbackTried = $false
  clipboardRestored = $false
  reason = "real_write_requires_allow_foreground_write"
  expectedTitleHashMatched = $false
  expectedToolProfileMatched = $false
  candidateIndex = $CandidateIndex
  exitCode = $null
  summary = [pscustomobject]@{
    requestedTextLength = 0
    requestedTextHash = ""
    verifiedTextLength = 0
    verifiedTextHash = ""
    autoSubmit = $false
    submitSignalCount = 0
  }
}

if ($AllowForegroundWrite) {
  $fillArgs = @(
    "-JsonOnly",
    "-ConfirmForeground",
    "-ExpectedTitleHash", $ExpectedTitleHash,
    "-ExpectedToolProfile", $ExpectedToolProfile,
    "-CandidateIndex", ([string]$CandidateIndex),
    "-Text", $Text
  )
  if ($AllowClipboardFallback) {
    $fillArgs += "-AllowClipboardFallback"
  }
  $fillProbe = Invoke-JsonProbe -Path (Join-Path $ScriptDir "check-m3-desktop-fill.ps1") -Arguments $fillArgs
  $fill = $fillProbe.json
  if ($fillProbe.parseOk -and $fill) {
    $write = [pscustomobject]@{
      allowed = $true
      attempted = [bool]$fill.writeAttempted
      pass = [bool]$fill.pass
      verified = [bool]$fill.verified
      strategy = if ($fill.strategy) { $fill.strategy } else { "" }
      clipboardFallbackAllowed = [bool]$AllowClipboardFallback
      clipboardFallbackTried = [bool]$fill.clipboardFallbackTried
      clipboardRestored = [bool]$fill.clipboardRestored
      reason = if ($fill.reason) { $fill.reason } else { "" }
      expectedTitleHashMatched = [bool]$fill.foreground.expectedTitleHashMatched
      expectedToolProfileMatched = [bool]$fill.foreground.expectedToolProfileMatched
      candidateIndex = $CandidateIndex
      exitCode = $fillProbe.exitCode
      summary = [pscustomobject]@{
        requestedTextLength = if ($fill.summary) { [int]$fill.summary.requestedTextLength } else { 0 }
        requestedTextHash = if ($fill.summary) { $fill.summary.requestedTextHash } else { "" }
        verifiedTextLength = if ($fill.summary) { [int]$fill.summary.verifiedTextLength } else { 0 }
        verifiedTextHash = if ($fill.summary) { $fill.summary.verifiedTextHash } else { "" }
        autoSubmit = if ($fill.summary) { [bool]$fill.summary.autoSubmit } else { $false }
        submitSignalCount = if ($fill.summary) { [int]$fill.summary.submitSignalCount } else { 0 }
      }
    }
  } else {
    $write = [pscustomobject]@{
      allowed = $true
      attempted = $false
      pass = $false
      verified = $false
      strategy = ""
      clipboardFallbackAllowed = [bool]$AllowClipboardFallback
      clipboardFallbackTried = $false
      clipboardRestored = $false
      reason = "foreground_fill_probe_json_parse_failed"
      expectedTitleHashMatched = $false
      expectedToolProfileMatched = $false
      candidateIndex = $CandidateIndex
      exitCode = $fillProbe.exitCode
      summary = [pscustomobject]@{
        requestedTextLength = 0
        requestedTextHash = ""
        verifiedTextLength = 0
        verifiedTextHash = ""
        autoSubmit = $false
        submitSignalCount = 0
      }
    }
  }
}

$coverage = @()
foreach ($profile in $RequestedProfiles) {
  $writeValidated = [bool]($write.pass -and $write.verified -and $ExpectedToolProfile -eq $profile)
  $coverage += New-CoverageRow -Profile $profile -DetectedProfile $detectedToolProfile -CandidateCount $candidateCount -WriteValidated $writeValidated
}

$privacyOk = [bool](
  $snapshot -and
  $snapshot.privacy -and
  $snapshot.privacy.titleRedacted -and
  $snapshot.privacy.elementNamesHashed -and
  $snapshot.privacy.elementValuesNotRead -and
  $snapshot.privacy.promptTextNotRead -and
  (-not $write.summary.autoSubmit) -and
  ([int]$write.summary.submitSignalCount -eq 0)
)

$validatedWrites = @($coverage | Where-Object { $_.realWindowWriteValidated }).Count
$completionImpact = "real_tool_write_still_pending"
if ($validatedWrites -gt 0 -and $validatedWrites -lt $RequestedProfiles.Count) {
  $completionImpact = "partial_real_tool_write_validated"
} elseif ($validatedWrites -eq $RequestedProfiles.Count -and $RequestedProfiles.Count -gt 0) {
  $completionImpact = "all_requested_real_tool_writes_validated"
} elseif (-not $foreground.hasTargetForeground) {
  $completionImpact = "target_tool_not_foreground"
}

$reportObject = [pscustomobject]@{
  schemaVersion = "m3-real-desktop-tools@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = if ($env:OS -like "*Windows*") { "win32" } else { $PSVersionTable.Platform }
  pass = [bool]($snapshotOk -and $privacyOk)
  requestedProfiles = $RequestedProfiles
  supportedToolProfiles = $SupportedProfiles
  foreground = $foreground
  snapshot = [pscustomobject]@{
    exitCode = $inputProbe.exitCode
    parseOk = [bool]$inputProbe.parseOk
    parseError = $inputProbe.parseError
    probeOk = [bool]$snapshotOk
    candidateCount = $candidateCount
    valuePatternCandidates = if ($snapshot.summary) { [int]$snapshot.summary.valuePatternCandidates } else { 0 }
    textPatternCandidates = if ($snapshot.summary) { [int]$snapshot.summary.textPatternCandidates } else { 0 }
    focusableCandidates = if ($snapshot.summary) { [int]$snapshot.summary.focusableCandidates } else { 0 }
  }
  write = $write
  coverage = $coverage
  checks = [pscustomobject]@{
    snapshotOk = [bool]$snapshotOk
    supportedProfilesPresent = [bool]($SupportedProfiles.Count -eq 3)
    foregroundClassified = [bool]($detectedToolProfile.Length -gt 0)
    hasTargetForeground = [bool]$foreground.hasTargetForeground
    writeAttempted = [bool]$write.attempted
    writeValidated = [bool]($write.pass -and $write.verified)
    privacyRedacted = [bool]$privacyOk
    rawTitleStored = $false
    rawElementNamesStored = $false
    rawInputValuesStored = $false
    rawPromptTextStored = $false
    noAutoSubmit = [bool]((-not $write.summary.autoSubmit) -and ([int]$write.summary.submitSignalCount -eq 0))
  }
  privacy = [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotRead = $true
    promptTextNotRead = $true
    writtenTextNotStored = $true
    clipboardTextNotStored = $true
    fallbackRequiresExplicitAllow = $true
    verificationUsesLengthAndHash = $true
    autoSubmit = $false
  }
  completionImpact = $completionImpact
}

$json = $reportObject | ConvertTo-Json -Depth 10
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 real desktop tools report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
