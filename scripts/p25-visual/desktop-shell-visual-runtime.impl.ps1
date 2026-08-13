param(
  [string]$Report = "research/p25-desktop-shell-visual-runtime.latest.json",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$StartReport = "research/p25-desktop-shell-start.latest.json",
  [string]$RuntimeReadinessReport = "research/p25-runtime-readiness.latest.json",
  [string]$OverlayNoActivateReport = "research/p25-mascot-overlay-noactivate.latest.json",
  [string]$OverlayVisualAttachReport = "research/p25-overlay-window-visual-attach.latest.json",
  [string]$OverlayVisualScreenshot = "research/p25-overlay-window-visual-attach.png",
  [string]$OverlayClickChainReport = "research/p25-overlay-click-chain.latest.json",
  [int]$TimeoutSeconds = 20,
  [switch]$AllowStartDesktopShell,
  [switch]$AllowVisualScreenshot,
  [switch]$AllowFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent (Split-Path -Parent $ScriptDir)

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

$startScript = Resolve-RepoPath "scripts/start-p25-desktop-shell-candidate.ps1"
$visualScript = Resolve-RepoPath "scripts/check-p25-visual.ps1"
$chainScript = Resolve-RepoPath "scripts/check-p25-overlay-click-chain.ps1"
$resolvedReport = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $resolvedReport
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$stepExitCodes = [ordered]@{}

$startArgs = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript,
  "-TransparentReleaseExe", $TransparentReleaseExe,
  "-Report", $StartReport,
  "-RuntimeReadinessReport", $RuntimeReadinessReport,
  "-TimeoutSeconds", $TimeoutSeconds,
  "-AllowFailure"
)
if ($AllowStartDesktopShell) {
  $startArgs += "-AllowStartDesktopShell"
}
$stepExitCodes.startGate = Run-Step { powershell @startArgs }

$startReportObject = Read-JsonReport $StartReport
$runtimeReadiness = Read-JsonReport $RuntimeReadinessReport
$runtimeProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.processCount } else { 0 }
$runtimeCompletionReady = [bool]($runtimeReadiness -and $runtimeReadiness.completionReady)
$noActivateRan = $false
$overlayVisualAttachRan = $false

if ($runtimeProcessCount -gt 0) {
  $noActivateRan = $true
  $stepExitCodes.noActivateAttachOnly = Run-Step {
    powershell -NoProfile -ExecutionPolicy Bypass -File $visualScript `
      -Mode MascotOverlayNoActivate `
      -ExePath $TransparentReleaseExe `
      -Report $OverlayNoActivateReport `
      -AttachOnly `
      -KeepRunning `
      -TimeoutSeconds $TimeoutSeconds `
      -AllowFailure
  }
} else {
  $stepExitCodes.noActivateAttachOnly = $null
}

$visualAttachTimeoutSeconds = if ($runtimeProcessCount -gt 0 -or $AllowStartDesktopShell) {
  [Math]::Max(0, $TimeoutSeconds)
} else {
  [Math]::Min(3, [Math]::Max(0, $TimeoutSeconds))
}
$overlayVisualAttachRan = $true
$visualAttachArgs = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $visualScript,
  "-Mode", "OverlayWindowVisualAttach",
  "-Report", $OverlayVisualAttachReport,
  "-Screenshot", $OverlayVisualScreenshot,
  "-TimeoutSeconds", $visualAttachTimeoutSeconds,
  "-AllowFailure"
)
if ($AllowVisualScreenshot) {
  $visualAttachArgs += "-AllowScreenshot"
}
$stepExitCodes.overlayVisualAttach = Run-Step { powershell @visualAttachArgs }

$overlayNoActivate = if ($noActivateRan) { Read-JsonReport $OverlayNoActivateReport } else { $null }
$overlayVisualAttach = if ($overlayVisualAttachRan) { Read-JsonReport $OverlayVisualAttachReport } else { $null }

$stepExitCodes.overlayClickChain = Run-Step {
  powershell -NoProfile -ExecutionPolicy Bypass -File $chainScript `
    -Report $OverlayClickChainReport `
    -RuntimeReadinessReport $RuntimeReadinessReport `
    -OverlayVisualAttachReport $OverlayVisualAttachReport `
    -OverlayNoActivateReport $OverlayNoActivateReport `
    -TransparentReleaseExe $TransparentReleaseExe
}
$overlayClickChain = Read-JsonReport $OverlayClickChainReport

$visualRuntimeReady = [bool](
  $runtimeCompletionReady -and
  $overlayNoActivate -and
  $overlayNoActivate.pass -and
  $overlayVisualAttach -and
  $overlayVisualAttach.pass -and
  $overlayClickChain -and
  $overlayClickChain.runtimeChecks.overlayChatVisualPass -and
  $overlayClickChain.runtimeChecks.overlayChatVisualRetryWorks
)

$completionImpact = if ($visualRuntimeReady) {
  "desktop_shell_visual_runtime_ready"
} elseif (-not $AllowStartDesktopShell) {
  "start_not_allowed"
} elseif (-not $runtimeCompletionReady) {
  "runtime_readiness_missing"
} elseif (-not ($overlayNoActivate -and $overlayNoActivate.pass)) {
  "overlay_no_activate_missing"
} elseif (-not ($overlayVisualAttach -and $overlayVisualAttach.pass)) {
  "overlay_window_visual_attach_missing"
} else {
  "visual_runtime_evidence_incomplete"
}
$startStatus = if ($startReportObject) { [string]$startReportObject.status } else { "" }
$startDiagnostics = if ($startReportObject -and $startReportObject.diagnostics) { $startReportObject.diagnostics } else { $null }
$overlayAttachImpact = if ($overlayVisualAttach) { [string]$overlayVisualAttach.completionImpact } else { "" }
$chainChecks = if ($overlayClickChain -and $overlayClickChain.runtimeChecks) { $overlayClickChain.runtimeChecks } else { $null }
$chainStatic = if ($overlayClickChain -and $overlayClickChain.staticChecks) { $overlayClickChain.staticChecks } else { $null }
$frontendAutoDetectBootstrapsOnAppLoad = [bool]($chainStatic -and $chainStatic.autoDetectBootstrapsOnAppLoad)
$frontendAutoDetectStartsLocalService = [bool]($chainStatic -and $chainStatic.autoDetectStartsLocalService)
$frontendAutoDetectPollsSnapshot = [bool]($chainStatic -and $chainStatic.autoDetectPollsSnapshot)
$frontendAutoDetectDoesInitialRefresh = [bool]($chainStatic -and $chainStatic.autoDetectDoesInitialRefresh)
$frontendAutoDetectTestCoversAutoShow = [bool]($chainStatic -and $chainStatic.interactionTestCoversAutoShow)
$frontendAutoDetectReady = [bool](
  $frontendAutoDetectBootstrapsOnAppLoad -and
  $frontendAutoDetectStartsLocalService -and
  $frontendAutoDetectPollsSnapshot -and
  $frontendAutoDetectDoesInitialRefresh -and
  $frontendAutoDetectTestCoversAutoShow
)
$diagnosticNextAction = if ($visualRuntimeReady) {
  "visual_runtime_ready_for_read_only_real_click_gate"
} elseif (-not $AllowStartDesktopShell) {
  "explicitly_allow_start_to_verify_real_overlay_window"
} elseif ($startDiagnostics -and $startDiagnostics.existingProcessBlocksStart) {
  "resolve_existing_desktop_shell_process_before_starting_candidate"
} elseif (-not $runtimeCompletionReady) {
  "inspect_runtime_readiness_process_match"
} elseif (-not ($overlayNoActivate -and $overlayNoActivate.pass)) {
  "inspect_overlay_no_activate_window_styles"
} elseif (-not ($overlayVisualAttach -and $overlayVisualAttach.pass)) {
  "inspect_real_overlay_window_geometry_or_white_block"
} else {
  "inspect_overlay_click_chain_report"
}

$reportObject = [ordered]@{
  schemaVersion = "p25-desktop-shell-visual-runtime@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$visualRuntimeReady
  visualRuntimeReady = [bool]$visualRuntimeReady
  completionReady = [bool]$visualRuntimeReady
  completionImpact = [string]$completionImpact
  steps = $stepExitCodes
  startGate = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $StartReport)
    status = if ($startReportObject) { [string]$startReportObject.status } else { "" }
    startAllowed = [bool]($startReportObject -and $startReportObject.safety.startAllowed)
    startAttempted = [bool]($startReportObject -and $startReportObject.safety.startAttempted)
    beforeCount = if ($startReportObject -and $startReportObject.process) { [int]$startReportObject.process.beforeCount } else { 0 }
    afterCount = if ($startReportObject -and $startReportObject.process) { [int]$startReportObject.process.afterCount } else { 0 }
  }
  runtimeReadiness = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $RuntimeReadinessReport)
    completionReady = [bool]$runtimeCompletionReady
    processCount = [int]$runtimeProcessCount
    matchingProcessCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.matchingProcessCount } else { 0 }
    overlayWindowCount = if ($runtimeReadiness -and $runtimeReadiness.checks) { [int]$runtimeReadiness.checks.overlayWindowCount } else { 0 }
    overlayMatchesDesktopShellProcess = [bool]($runtimeReadiness -and $runtimeReadiness.checks.overlayMatchesDesktopShellProcess)
  }
  overlayNoActivate = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayNoActivateReport)
    ran = [bool]$noActivateRan
    pass = if ($noActivateRan) { [bool]($overlayNoActivate -and $overlayNoActivate.pass) } else { $false }
    attachedExisting = if ($noActivateRan) { [bool]($overlayNoActivate -and $overlayNoActivate.attachedExisting) } else { $false }
    attachOnly = if ($noActivateRan) { [bool]($overlayNoActivate -and $overlayNoActivate.attachOnly) } else { $false }
    launchedProcessId = if ($noActivateRan -and $overlayNoActivate -and $overlayNoActivate.launchedProcessId) { [int]$overlayNoActivate.launchedProcessId } else { $null }
  }
  overlayVisualAttach = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayVisualAttachReport)
    ran = [bool]$overlayVisualAttachRan
    timeoutSeconds = [int]$visualAttachTimeoutSeconds
    pass = if ($overlayVisualAttachRan) { [bool]($overlayVisualAttach -and $overlayVisualAttach.pass) } else { $false }
    completionImpact = if ($overlayVisualAttachRan -and $overlayVisualAttach) { [string]$overlayVisualAttach.completionImpact } else { "" }
    windowCount = if ($overlayVisualAttachRan -and $overlayVisualAttach) { [int]$overlayVisualAttach.windowCount } else { 0 }
    noActivateStyle = if ($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.checks) { [bool]$overlayVisualAttach.checks.noActivateStyle } else { $false }
    geometryMatchesExpectedOverlaySize = if ($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.checks) { [bool]$overlayVisualAttach.checks.geometryMatchesExpectedOverlaySize } else { $false }
    largeWhiteBlockAbsent = if ($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.checks) { [bool]$overlayVisualAttach.checks.largeWhiteBlockAbsent } else { $false }
    screenshotSaved = if ($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.checks) { [bool]$overlayVisualAttach.checks.screenshotSaved } else { $false }
  }
  overlayClickChain = [ordered]@{
    report = ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayClickChainReport)
    completionReady = [bool]($overlayClickChain -and $overlayClickChain.completionReady)
    completionImpact = if ($overlayClickChain) { [string]$overlayClickChain.completionImpact } else { "" }
    overlayChatVisualPass = [bool]($overlayClickChain -and $overlayClickChain.runtimeChecks.overlayChatVisualPass)
    overlayChatVisualRetryWorks = [bool]($overlayClickChain -and $overlayClickChain.runtimeChecks.overlayChatVisualRetryWorks)
    overlayChatVisualWhiteBlockRegressionOk = [bool]($overlayClickChain -and $overlayClickChain.runtimeChecks.overlayChatVisualWhiteBlockRegressionOk)
    realOverlayClickVerified = [bool]($overlayClickChain -and $overlayClickChain.runtimeChecks.realOverlayClickVerified)
    autoDetectBootstrapsOnAppLoad = [bool]$frontendAutoDetectBootstrapsOnAppLoad
    autoDetectStartsLocalService = [bool]$frontendAutoDetectStartsLocalService
    autoDetectPollsSnapshot = [bool]$frontendAutoDetectPollsSnapshot
    autoDetectDoesInitialRefresh = [bool]$frontendAutoDetectDoesInitialRefresh
    interactionTestCoversAutoShow = [bool]$frontendAutoDetectTestCoversAutoShow
  }
  frontendAutoDetect = [ordered]@{
    bootstrapsOnAppLoad = [bool]$frontendAutoDetectBootstrapsOnAppLoad
    startsLocalService = [bool]$frontendAutoDetectStartsLocalService
    pollsSnapshot = [bool]$frontendAutoDetectPollsSnapshot
    doesInitialRefresh = [bool]$frontendAutoDetectDoesInitialRefresh
    interactionTestCoversAutoShow = [bool]$frontendAutoDetectTestCoversAutoShow
    readyForAuthorizedStart = [bool]$frontendAutoDetectReady
  }
  diagnostics = [ordered]@{
    candidateReady = [bool]($runtimeReadiness -and $runtimeReadiness.checks -and $runtimeReadiness.checks.candidateReady)
    startStatus = [string]$startStatus
    startAttempted = [bool]($startReportObject -and $startReportObject.safety.startAttempted)
    startAllowed = [bool]$AllowStartDesktopShell
    existingProcessBlocksStart = [bool]($startDiagnostics -and $startDiagnostics.existingProcessBlocksStart)
    runtimeProcessMissing = [bool]($runtimeProcessCount -eq 0)
    runtimeMatchesCandidate = [bool]($runtimeCompletionReady)
    overlayAutoDetectStaticEvidence = [bool]$frontendAutoDetectReady
    overlayWindowMissing = [bool]($overlayAttachImpact -eq "overlay_window_missing")
    overlayWindowGeometryUnexpected = [bool]($overlayAttachImpact -eq "overlay_geometry_unexpected")
    overlayWhiteBlockSuspected = [bool]($overlayAttachImpact -eq "overlay_visual_white_block_suspected")
    overlayNoActivateMissing = [bool](
      ($overlayAttachImpact -eq "overlay_no_activate_missing") -or
      ($runtimeCompletionReady -and -not ($overlayNoActivate -and $overlayNoActivate.pass))
    )
    realOverlayClickStillBlocked = [bool](-not ($overlayClickChain -and $overlayClickChain.runtimeChecks.realOverlayClickVerified))
    visualRunDoesNotAttemptRealClickOrFill = $true
    targetSafeCandidatesReady = [bool]($chainChecks -and $chainChecks.targetsSafeCandidatesReady)
    nextAction = [string]$diagnosticNextAction
  }
  safety = [ordered]@{
    startRequiresExplicitAllow = $true
    startAllowed = [bool]$AllowStartDesktopShell
    stopAttempted = $false
    killAttempted = $false
    replaceAttempted = $false
    realOverlayClickAttempted = $false
    foregroundFillAttempted = $false
    fillLatestReadAttempted = $false
    targetWriteAttempted = $false
    visualScreenshotAllowed = [bool]$AllowVisualScreenshot
  }
  scope = [ordered]@{
    verifiesVisualRuntimeOnly = $true
    doesNotVerifyRealOverlayClick = $true
    doesNotVerifyRealFill = $true
    doesNotPollLatestFill = $true
    doesNotVerifySafeCandidate = $true
  }
  privacy = [ordered]@{
    noPromptTextRead = $true
    noTargetInputRead = $true
    noRawTitlesRead = $true
    rawUiaNamesNotRead = $true
    clipboardTextNotRead = $true
    rawDesktopPixelsPersisted = [bool]($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.privacy.rawDesktopPixelsPersisted)
    onlyMetadataStored = [bool](-not ($overlayVisualAttachRan -and $overlayVisualAttach -and $overlayVisualAttach.privacy.rawDesktopPixelsPersisted))
  }
}

$reportObject | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $resolvedReport
Write-Host "P25 desktop shell visual runtime report: $resolvedReport"
Write-Host ($reportObject | ConvertTo-Json -Depth 12)

if (-not $AllowFailure -and -not $visualRuntimeReady) {
  exit 1
}
