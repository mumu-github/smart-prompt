[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Report = "research/p25-composer-candidate-diagnostics.latest.json",
  [string]$SnapshotReport = "research/m3-desktop-input.latest.json",
  [string]$TargetsReport = "research/p25-real-desktop-targets.latest.json",
  [ValidateSet("codex", "workbuddy", "trae")]
  [string[]]$Profiles = @("codex", "workbuddy", "trae"),
  [switch]$RefreshSnapshot,
  [int]$MaxCandidates = 24
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

function Read-JsonFile {
  param([string]$PathValue)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-PreferredWritableInputCandidate {
  param([object]$Candidate)
  if (-not $Candidate -or -not [bool]$Candidate.isEnabled) { return $false }
  $controlType = [string]$Candidate.controlType
  $signals = $Candidate.inputSignals
  if ($controlType -match "Button|Hyperlink|Text") { return $false }
  if ([bool]$signals.broadDocument) { return $false }
  if ($controlType -match "Edit") { return $true }
  if ([bool]$signals.hasKeyboardFocus -or [bool]$signals.focusedElementMatch -or [bool]$signals.caretWithinBounds -or [bool]$signals.caretWindowMatch) { return $true }
  if ([bool]$Candidate.hasValuePattern -and $controlType -notmatch "Document") { return $true }
  if ([bool]$Candidate.hasTextPattern -and $controlType -eq "ControlType.Document") { return $true }
  return $false
}

function Test-GeometryLooksLikeComposer {
  param([object]$Candidate)
  $rect = $Candidate.boundingRect
  $signals = $Candidate.inputSignals
  return [bool](
    $signals.nearWindowBottom -and
    [int]$rect.width -ge 240 -and
    [int]$rect.height -ge 36 -and
    [int]$rect.height -le 260 -and
    -not $signals.broadDocument
  )
}

function Test-StrongInputSignal {
  param([object]$Candidate)
  $signals = $Candidate.inputSignals
  return [bool](
    $signals.hasKeyboardFocus -or
    $signals.focusedElementMatch -or
    $signals.caretWithinBounds -or
    $signals.caretWindowMatch -or
    $signals.cursorWithinBounds -or
    $signals.semanticComposerHint
  )
}

function Test-ProfileComposerCandidate {
  param([string]$Profile, [object]$Candidate)
  if ($Profile -notin @("workbuddy", "trae")) { return $true }
  return [bool](Test-GeometryLooksLikeComposer -Candidate $Candidate) -and [bool](Test-StrongInputSignal -Candidate $Candidate)
}

function Test-CodexBrowserLikeComposerCandidate {
  param([string]$Profile, [object]$Candidate)
  if ($Profile -ne "codex") { return $false }
  if ([string]$Candidate.controlType -ne "ControlType.Document") { return $false }
  if (-not [bool]$Candidate.isEnabled -or -not [bool]$Candidate.isKeyboardFocusable) { return $false }
  $signals = $Candidate.inputSignals
  if (-not [bool]$signals.broadDocument) { return $false }
  if (-not [bool]$signals.nearWindowBottom) { return $false }
  return [bool](
    $signals.hasKeyboardFocus -or
    $signals.focusedElementMatch -or
    $signals.caretWithinBounds -or
    $signals.caretWindowMatch -or
    $signals.cursorWithinBounds
  )
}

function Get-CandidateReason {
  param([string]$Profile, [object]$Candidate)
  if (-not [bool]$Candidate.isEnabled) { return "disabled" }
  $controlType = [string]$Candidate.controlType
  $signals = $Candidate.inputSignals
  $rect = $Candidate.boundingRect
  if ($controlType -match "Button|Hyperlink") { return "button_or_hyperlink" }
  if ($controlType -eq "ControlType.Text") { return "static_text" }
  if (Test-CodexBrowserLikeComposerCandidate -Profile $Profile -Candidate $Candidate) { return "browser_like_composer_blocked" }
  if ([bool]$signals.broadDocument) { return "broad_document" }
  if ([int]$rect.width -lt 140 -or [int]$rect.height -lt 32 -or [int]$rect.height -gt 260) { return "geometry_outside_composer_range" }
  if ([int]$rect.x -lt -4 -or [int]$rect.y -lt -4) { return "offscreen_or_negative_bounds" }
  if (-not [bool]$signals.nearWindowBottom) { return "not_near_window_bottom" }
  if (-not (Test-PreferredWritableInputCandidate -Candidate $Candidate)) { return "no_safe_writable_signal" }
  if ($Profile -in @("workbuddy", "trae") -and -not (Test-ProfileComposerCandidate -Profile $Profile -Candidate $Candidate)) { return "profile_composer_guard_failed" }
  return "safe_candidate"
}

function Get-BrowserLikeDeficitSignals {
  param([object]$Candidate)
  $signals = $Candidate.inputSignals
  $controlType = [string]$Candidate.controlType
  $isEditLike = [bool]($controlType -match "Edit")
  $isDocumentTextPattern = [bool]($controlType -eq "ControlType.Document" -and [bool]$Candidate.hasTextPattern)
  $preferredWritableEligible = [bool](Test-PreferredWritableInputCandidate -Candidate $Candidate)
  $strongSignal = [bool](
    $signals.hasKeyboardFocus -or
    $signals.focusedElementMatch -or
    $signals.caretWithinBounds -or
    $signals.caretWindowMatch -or
    $signals.cursorWithinBounds
  )
  $missingEnabled = -not [bool]$Candidate.isEnabled
  $missingKeyboardFocusable = -not [bool]$Candidate.isKeyboardFocusable
  $missingWritableType = -not ($isEditLike -or $isDocumentTextPattern -or [bool]$Candidate.hasValuePattern)
  $missingBroadDocumentGuard = [bool]$signals.broadDocument
  $missingStrongInput = -not $strongSignal
  $missingWritableControl = -not [bool]$Candidate.hasTextPattern -and -not [bool]$Candidate.hasValuePattern
  $missingSignalCount = 0
  if ($missingEnabled) { $missingSignalCount += 1 }
  if ($missingKeyboardFocusable) { $missingSignalCount += 1 }
  if ($missingWritableType) { $missingSignalCount += 1 }
  if ($missingBroadDocumentGuard) { $missingSignalCount += 1 }
  if ($missingStrongInput) { $missingSignalCount += 1 }
  if ($missingWritableControl) { $missingSignalCount += 1 }
  return [ordered]@{
    preferredWritableEligible = $preferredWritableEligible
    strongSignalPresent = $strongSignal
    hasKeyboardFocus = [bool]$signals.hasKeyboardFocus
    focusedElementMatch = [bool]$signals.focusedElementMatch
    caretWithinBounds = [bool]$signals.caretWithinBounds
    caretWindowMatch = [bool]$signals.caretWindowMatch
    cursorWithinBounds = [bool]$signals.cursorWithinBounds
    nearWindowBottom = [bool]$signals.nearWindowBottom
    broadDocument = [bool]$signals.broadDocument
    missingEnabled = $missingEnabled
    missingKeyboardFocusable = $missingKeyboardFocusable
    missingWritableType = $missingWritableType
    missingWritableControlPattern = $missingWritableControl
    missingStrongInputSignal = $missingStrongInput
    missingBroadDocumentGuard = $missingBroadDocumentGuard
    missingSignalCount = [int]$missingSignalCount
  }
}

function New-CandidateDiagnostic {
  param([string]$Profile, [object]$Candidate)
  $signals = $Candidate.inputSignals
  $rect = $Candidate.boundingRect
  $reason = Get-CandidateReason -Profile $Profile -Candidate $Candidate
  $isBrowserLikeComposerCandidate = [bool](Test-CodexBrowserLikeComposerCandidate -Profile $Profile -Candidate $Candidate)
  $browserLikeDeficitSignals = if ($isBrowserLikeComposerCandidate) { Get-BrowserLikeDeficitSignals -Candidate $Candidate } else { $null }
  return [pscustomobject]@{
    index = [int]$Candidate.index
    reason = $reason
    safeCandidate = [bool]($reason -eq "safe_candidate")
    isBrowserLikeComposerCandidate = $isBrowserLikeComposerCandidate
    browserLikeDeficitSignals = $browserLikeDeficitSignals
    controlType = [string]$Candidate.controlType
    isKeyboardFocusable = [bool]$Candidate.isKeyboardFocusable
    isEnabled = [bool]$Candidate.isEnabled
    hasValuePattern = [bool]$Candidate.hasValuePattern
    hasTextPattern = [bool]$Candidate.hasTextPattern
    boundingRect = [ordered]@{
      x = [int]$rect.x
      y = [int]$rect.y
      width = [int]$rect.width
      height = [int]$rect.height
    }
    inputSignals = [ordered]@{
      score = [int]$signals.score
      hasKeyboardFocus = [bool]$signals.hasKeyboardFocus
      focusedElementMatch = [bool]$signals.focusedElementMatch
      caretWithinBounds = [bool]$signals.caretWithinBounds
      caretWindowMatch = [bool]$signals.caretWindowMatch
      cursorWithinBounds = [bool]$signals.cursorWithinBounds
      nearWindowBottom = [bool]$signals.nearWindowBottom
      broadDocument = [bool]$signals.broadDocument
      semanticComposerHint = [bool]$signals.semanticComposerHint
      profileComposerCandidate = [bool]$signals.profileComposerCandidate
    }
    hashes = [ordered]@{
      nameHash = [string]$Candidate.nameHash
      automationIdHash = [string]$Candidate.automationIdHash
      classNameHash = [string]$Candidate.classNameHash
    }
  }
}

if ($RefreshSnapshot) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-input.ps1") -Report (Resolve-RepoPath $SnapshotReport) | Out-Null
}

$snapshot = Read-JsonFile $SnapshotReport
$targets = Read-JsonFile $TargetsReport
$profile = if ($snapshot -and $snapshot.summary -and $snapshot.summary.detectedToolProfile) {
  [string]$snapshot.summary.detectedToolProfile
} elseif ($snapshot -and $snapshot.foreground -and $snapshot.foreground.detectedToolProfile) {
  [string]$snapshot.foreground.detectedToolProfile
} else {
  "unknown"
}

$candidates = @()
if ($snapshot -and $snapshot.candidates) {
  $candidates = @($snapshot.candidates)
}

$diagnostics = @(
  $candidates |
    Sort-Object @{ Expression = { [int]$_.inputSignals.score }; Descending = $true }, @{ Expression = { [int]$_.index }; Ascending = $true } |
    Select-Object -First ([Math]::Max(1, $MaxCandidates)) |
    ForEach-Object { New-CandidateDiagnostic -Profile $profile -Candidate $_ }
)

$reasonCounts = [ordered]@{}
foreach ($candidate in $candidates) {
  $reason = Get-CandidateReason -Profile $profile -Candidate $candidate
  if (-not $reasonCounts.Contains($reason)) {
    $reasonCounts[$reason] = 0
  }
  $reasonCounts[$reason] = [int]$reasonCounts[$reason] + 1
}

$browserLikeBlockedCandidates = @($diagnostics | Where-Object { $_.isBrowserLikeComposerCandidate -and $_.reason -eq "browser_like_composer_blocked" })
$browserLikeDeficitSummary = [ordered]@{
  blockedCandidateCount = [int]$browserLikeBlockedCandidates.Count
  missingEnabledCount = 0
  missingKeyboardFocusableCount = 0
  missingWritableTypeCount = 0
  missingStrongInputSignalCount = 0
  missingBroadDocumentGuardCount = 0
  missingWritableControlPatternCount = 0
  missingSignalCandidatesCount = 0
  preferredWritableEligibleCount = 0
}
foreach ($blocked in $browserLikeBlockedCandidates) {
  if (-not $blocked.browserLikeDeficitSignals) { continue }
  if ([bool]$blocked.browserLikeDeficitSignals.missingEnabled) { $browserLikeDeficitSummary.missingEnabledCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.missingKeyboardFocusable) { $browserLikeDeficitSummary.missingKeyboardFocusableCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.missingWritableType) { $browserLikeDeficitSummary.missingWritableTypeCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.missingStrongInputSignal) { $browserLikeDeficitSummary.missingStrongInputSignalCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.missingBroadDocumentGuard) { $browserLikeDeficitSummary.missingBroadDocumentGuardCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.missingWritableControlPattern) { $browserLikeDeficitSummary.missingWritableControlPatternCount += 1 }
  if ([int]$blocked.browserLikeDeficitSignals.missingSignalCount -gt 0) { $browserLikeDeficitSummary.missingSignalCandidatesCount += 1 }
  if ([bool]$blocked.browserLikeDeficitSignals.preferredWritableEligible) { $browserLikeDeficitSummary.preferredWritableEligibleCount += 1 }
}

$targetRows = @()
if ($targets -and $targets.targets) {
  $wanted = @($Profiles | Select-Object -Unique)
  $targetRows = @($targets.targets | Where-Object { $wanted -contains $_.id } | ForEach-Object {
    [pscustomobject]@{
      id = [string]$_.id
      windowFound = [bool]$_.windowFound
      strictForegroundDetected = [bool]$_.strictForegroundDetected
      selectionSource = [string]$_.selectionSource
      targetSnapshotApplies = [bool]$_.targetSnapshotApplies
      targetCandidateCount = [int]$_.targetCandidateCount
      targetSafeCandidateCount = [int]$_.targetSafeCandidateCount
      targetBestCandidateIndex = [int]$_.targetBestCandidateIndex
      writeVerified = [bool]$_.writeVerified
    }
  })
}

$summary = [ordered]@{
  detectedToolProfile = $profile
  selectionSource = if ($snapshot -and $snapshot.selection -and $snapshot.selection.source) { [string]$snapshot.selection.source } else { "foreground_window" }
  candidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.candidateCount) { [int]$snapshot.summary.candidateCount } else { $candidates.Count }
  safeCandidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.safeCandidateCount) { [int]$snapshot.summary.safeCandidateCount } else { @($diagnostics | Where-Object { $_.safeCandidate }).Count }
  browserLikeComposerCandidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.browserLikeComposerCandidateCount) { [int]$snapshot.summary.browserLikeComposerCandidateCount } else { @($diagnostics | Where-Object { $_.isBrowserLikeComposerCandidate }).Count }
  semanticCandidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.semanticCandidateCount) { [int]$snapshot.summary.semanticCandidateCount } else { @($candidates | Where-Object { $_.inputSignals.semanticComposerHint }).Count }
  focusedCandidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.focusedCandidateCount) { [int]$snapshot.summary.focusedCandidateCount } else { @($candidates | Where-Object { $_.inputSignals.hasKeyboardFocus -or $_.inputSignals.focusedElementMatch }).Count }
  caretCandidateCount = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.caretCandidateCount) { [int]$snapshot.summary.caretCandidateCount } else { @($candidates | Where-Object { $_.inputSignals.caretWithinBounds -or $_.inputSignals.caretWindowMatch }).Count }
  bestCandidateIndex = if ($snapshot -and $snapshot.summary -and $null -ne $snapshot.summary.bestCandidateIndex) { [int]$snapshot.summary.bestCandidateIndex } else { -1 }
  topReasonCounts = $reasonCounts
  browserLikeDeficitSummary = $browserLikeDeficitSummary
}

$reportPath = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$reportObject = [ordered]@{
  schemaVersion = "p25-composer-candidate-diagnostics@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]($snapshot -and $snapshot.probeOk -and $snapshot.privacy -and $snapshot.privacy.elementValuesNotRead -and $snapshot.privacy.titleRedacted)
  completionReady = $false
  completionImpact = if (-not $snapshot) {
    "snapshot_report_missing"
  } elseif ($summary.browserLikeComposerCandidateCount -gt 0 -and $summary.safeCandidateCount -eq 0) {
    "safe_candidates_missing_but_browser_like_composer_exists"
  } elseif ($summary.safeCandidateCount -gt 0 -and $summary.selectionSource -eq "foreground_window" -and $profile -in @($Profiles)) {
    "composer_candidate_ready_needs_real_overlay_click"
  } elseif ($summary.safeCandidateCount -gt 0) {
    "safe_candidate_not_strict_foreground"
  } else {
    "safe_composer_candidate_missing"
  }
  refreshedSnapshot = [bool]$RefreshSnapshot
  reports = [ordered]@{
    snapshotReport = ConvertTo-RepoRelativePath (Resolve-RepoPath $SnapshotReport)
    targetsReport = ConvertTo-RepoRelativePath (Resolve-RepoPath $TargetsReport)
    outputReport = ConvertTo-RepoRelativePath $reportPath
  }
  summary = $summary
  targets = $targetRows
  candidates = $diagnostics
  privacy = [ordered]@{
    targetTitlesRedacted = $true
    targetInputsNotStored = $true
    elementValuesNotRead = $true
    promptTextNotStored = $true
    onlyHashesGeometryAndBooleans = $true
  }
}

$reportObject | ConvertTo-Json -Depth 16 | Set-Content -Encoding UTF8 -LiteralPath $reportPath
Write-Host "P25 composer candidate diagnostics report: $reportPath"
Write-Host ($reportObject | ConvertTo-Json -Depth 16)

if (-not $reportObject.pass) {
  exit 1
}
