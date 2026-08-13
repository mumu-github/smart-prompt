param(
  [string]$Report = "research/p25-overlay-click-chain.latest.json",
  [string]$TargetsReport = "research/p25-real-desktop-targets.latest.json",
  [string]$WriteGuardReport = "research/p25-real-desktop-targets-write-guard.latest.json",
  [string]$OverlayNoActivateReport = "research/p25-mascot-overlay-noactivate.latest.json",
  [string]$OverlayVisualAttachReport = "research/p25-overlay-window-visual-attach.latest.json",
  [string]$RealOverlayClickReport = "research/p25-real-overlay-click-fill.latest.json",
  [string]$ComposerDiagnosticsReport = "research/p25-composer-candidate-diagnostics.latest.json",
  [string]$OverlayChatVisualReport = "research/p25-overlay-chat-visual.latest.json",
  [string]$DesktopDraftCdpReport = "research/p25-desktop-shell-draft-cdp.latest.json",
  [string]$RuntimeReadinessReport = "research/p25-runtime-readiness.latest.json",
  [string]$DesktopShellStartReport = "research/p25-desktop-shell-start.latest.json",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

function Resolve-RepoPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path $Root $PathValue
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
    return $full.Substring($root.Length).Replace("\\", "/")
  }
  return $full.Replace("\\", "/")
}

function Test-TextContains {
  param([string]$Text, [string]$Needle)
  if ($null -eq $Text) { return $false }
  return $Text.Contains($Needle)
}

function Read-TextFile {
  param([string]$PathValue)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  return Get-Content -Raw -Encoding UTF8 -LiteralPath $path
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

function Get-FileLastWriteUtc {
  param([string]$PathValue)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return (Get-Item -LiteralPath $path).LastWriteTimeUtc
}

function Get-FileSizeBytes {
  param([string]$PathValue)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return (Get-Item -LiteralPath $path).Length
}

function Get-FileSha256Prefix {
  param([string]$PathValue, [int]$PrefixLength = 16)
  $path = Resolve-RepoPath $PathValue
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  try {
    $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
    return $hash.Hash.ToLowerInvariant().Substring(0, [Math]::Min($PrefixLength, $hash.Hash.Length))
  } catch {
    return ""
  }
}

function Get-LatestFileLastWriteUtc {
  param([string[]]$PathValues)
  $latest = $null
  foreach ($pathValue in $PathValues) {
    $timestamp = Get-FileLastWriteUtc $pathValue
    if ($timestamp -and (($null -eq $latest) -or ($timestamp -gt $latest))) {
      $latest = $timestamp
    }
  }
  return $latest
}

function Get-ReportSummary {
  param([object]$ReportObject)
  if (-not $ReportObject -or -not $ReportObject.summary) {
    return [pscustomobject]@{
      profileCount = 0
      strictForegroundDetectedCount = 0
      safeCandidateTargetCount = 0
      writeAttemptedCount = 0
      writeVerifiedCount = 0
      noAutoSubmit = $false
      privacyOk = $false
    }
  }
  return [pscustomobject]@{
    profileCount = [int]$ReportObject.summary.profileCount
    strictForegroundDetectedCount = if ($null -ne $ReportObject.summary.strictForegroundDetectedCount) { [int]$ReportObject.summary.strictForegroundDetectedCount } else { 0 }
    safeCandidateTargetCount = if ($null -ne $ReportObject.summary.safeCandidateTargetCount) { [int]$ReportObject.summary.safeCandidateTargetCount } else { 0 }
    writeAttemptedCount = if ($null -ne $ReportObject.summary.writeAttemptedCount) { [int]$ReportObject.summary.writeAttemptedCount } else { 0 }
    writeVerifiedCount = if ($null -ne $ReportObject.summary.writeVerifiedCount) { [int]$ReportObject.summary.writeVerifiedCount } else { 0 }
    noAutoSubmit = [bool]$ReportObject.summary.noAutoSubmit
    privacyOk = [bool]$ReportObject.summary.privacyOk
  }
}

$reportPath = Resolve-RepoPath $Report
$appSource = Read-TextFile "apps/desktop-shell/src/app.js"
$desktopOverlayLogicSource = Read-TextFile "apps/desktop-shell/src/desktop-overlay-logic.js"
$overlayRuntimeSource = $appSource + "`n" + $desktopOverlayLogicSource
$desktopHtml = Read-TextFile "apps/desktop-shell/index.html"
$overlayJs = Read-TextFile "apps/desktop-shell/src/overlay.js"
$overlayHtml = Read-TextFile "apps/desktop-shell/overlay.html"
$overlayCss = Read-TextFile "apps/desktop-shell/src/overlay.css"
$distOverlayHtml = Read-TextFile "apps/desktop-shell/dist/overlay.html"
$distOverlayJs = Read-TextFile "apps/desktop-shell/dist/src/overlay.js"
$distOverlayCss = Read-TextFile "apps/desktop-shell/dist/src/overlay.css"
$tauriMain = Read-TextFile "apps/desktop-shell/src-tauri/src/main.rs"
$interactionTest = Read-TextFile "apps/desktop-shell/tests/desktop-shell-interaction.test.js"
$realOverlayClickProbe = Read-TextFile "scripts/check-p25-real-overlay-click-fill.ps1"
$composerDiagnosticsProbe = Read-TextFile "scripts/check-p25-composer-candidate-diagnostics.ps1"
$overlayChatVisualProbe = Read-TextFile "scripts/check-assistant-card-visual.js"
$visualEntryProbe = Read-TextFile "scripts/check-p25-visual.ps1"
$overlayVisualAttachProbe = $visualEntryProbe + "`n" + (Read-TextFile "scripts/p25-visual/overlay-window-visual-attach.impl.ps1")
$desktopShellVisualRuntimeProbe = $visualEntryProbe + "`n" + (Read-TextFile "scripts/p25-visual/desktop-shell-visual-runtime.impl.ps1")
$desktopShellStartProbe = Read-TextFile "scripts/start-p25-desktop-shell-candidate.ps1"
$desktopDraftCdpPrep = Read-TextFile "scripts/prepare-p25-desktop-shell-draft-cdp.js"
$localService = Read-TextFile "apps/local-service/src/server.js"
$sidecar = Read-TextFile "apps/local-service-sidecar/src/main.rs"

$overlayNoActivate = Read-JsonFile $OverlayNoActivateReport
$overlayVisualAttach = Read-JsonFile $OverlayVisualAttachReport
$targets = Read-JsonFile $TargetsReport
$writeGuard = Read-JsonFile $WriteGuardReport
$realOverlayClick = Read-JsonFile $RealOverlayClickReport
$composerDiagnostics = Read-JsonFile $ComposerDiagnosticsReport
$overlayChatVisual = Read-JsonFile $OverlayChatVisualReport
$desktopDraftCdp = Read-JsonFile $DesktopDraftCdpReport
$runtimeReadiness = Read-JsonFile $RuntimeReadinessReport
$desktopShellStart = Read-JsonFile $DesktopShellStartReport

$overlayNoActivateReportTime = Get-FileLastWriteUtc $OverlayNoActivateReport
$overlayVisualAttachReportTime = Get-FileLastWriteUtc $OverlayVisualAttachReport
$overlayRuntimeSourceTime = Get-LatestFileLastWriteUtc @(
  "apps/desktop-shell/src-tauri/src/main.rs",
  "apps/desktop-shell/overlay.html",
  "apps/desktop-shell/src/overlay.css",
  "apps/desktop-shell/src/overlay.js",
  "apps/desktop-shell/src/app.js"
)
$desktopDistInputTime = Get-LatestFileLastWriteUtc @(
  "apps/desktop-shell/dist/index.html",
  "apps/desktop-shell/dist/overlay.html",
  "apps/desktop-shell/dist/src/app.js",
  "apps/desktop-shell/dist/src/overlay.css",
  "apps/desktop-shell/dist/src/overlay.js"
)
$transparentReleaseSourceTime = Get-LatestFileLastWriteUtc @(
  "apps/desktop-shell/src-tauri/src/main.rs",
  "apps/desktop-shell/src-tauri/Cargo.toml",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/overlay.html",
  "apps/desktop-shell/src/overlay.css",
  "apps/desktop-shell/src/overlay.js",
  "apps/desktop-shell/src/app.js",
  "apps/desktop-shell/scripts/prepare-dist.js",
  "apps/desktop-shell/dist/index.html",
  "apps/desktop-shell/dist/overlay.html",
  "apps/desktop-shell/dist/src/app.js",
  "apps/desktop-shell/dist/src/overlay.css",
  "apps/desktop-shell/dist/src/overlay.js"
)
$overlayTransparentReleasePath = Resolve-RepoPath $TransparentReleaseExe
$transparentReleaseExePresent = [bool](Test-Path -LiteralPath $overlayTransparentReleasePath)
$transparentReleaseExeTime = Get-FileLastWriteUtc $TransparentReleaseExe
$transparentReleaseExeSize = if ($transparentReleaseExePresent) { Get-FileSizeBytes $TransparentReleaseExe } else { $null }
$transparentReleaseExeSha256 = if ($transparentReleaseExePresent) { Get-FileSha256Prefix $TransparentReleaseExe } else { "" }
$runtimeReadinessReportTime = Get-FileLastWriteUtc $RuntimeReadinessReport
$desktopShellStartReportTime = Get-FileLastWriteUtc $DesktopShellStartReport
$runtimeReadinessSummary = if ($runtimeReadiness -and $runtimeReadiness.checks) {
  [pscustomobject]@{
    pass = [bool]$runtimeReadiness.pass
    completionReady = [bool]$runtimeReadiness.completionReady
    candidateFound = [bool]$runtimeReadiness.checks.candidateFound
    candidateRecent = [bool]$runtimeReadiness.checks.candidateRecent
    candidateFresh = [bool]$runtimeReadiness.checks.candidateFresh
    candidateReady = [bool]$runtimeReadiness.checks.candidateReady
    processCount = [int]$runtimeReadiness.checks.processCount
    matchingProcessCount = [int]$runtimeReadiness.checks.matchingProcessCount
    unknownPathProcessCount = [int]$runtimeReadiness.checks.unknownPathProcessCount
    allRunningProcessesMatchCandidate = [bool]$runtimeReadiness.checks.allRunningProcessesMatchCandidate
    overlayWindowCount = [int]$runtimeReadiness.checks.overlayWindowCount
    overlayMatchesDesktopShellProcess = [bool]$runtimeReadiness.checks.overlayMatchesDesktopShellProcess
    safetyOk = [bool](
      $runtimeReadiness.safety -and
      -not $runtimeReadiness.safety.processStartAttempted -and
      -not $runtimeReadiness.safety.processStopAttempted -and
      -not $runtimeReadiness.safety.processKillAttempted -and
      -not $runtimeReadiness.safety.realOverlayClickAttempted -and
      -not $runtimeReadiness.safety.writeAttempted
    )
    scopeOk = [bool](
      $runtimeReadiness.scope -and
      $runtimeReadiness.scope.doesNotVerifyRealOverlayClick -and
      $runtimeReadiness.scope.doesNotVerifyRealFill -and
      $runtimeReadiness.scope.doesNotVerifySafeCandidate
    )
    privacyOk = [bool](
      $runtimeReadiness.privacy -and
      $runtimeReadiness.privacy.noPromptTextRead -and
      $runtimeReadiness.privacy.noTargetInputRead -and
      $runtimeReadiness.privacy.noRawTitlesRead -and
      $runtimeReadiness.privacy.rawUiaNamesNotRead -and
      $runtimeReadiness.privacy.clipboardTextNotRead -and
      $runtimeReadiness.privacy.onlyMetadataStored
    )
    sidecarProcessCount = if ($runtimeReadiness.sidecarObservation) { [int]$runtimeReadiness.sidecarObservation.processCount } else { 0 }
  }
} else {
  [pscustomobject]@{
    pass = $false
    completionReady = $false
    candidateFound = $false
    candidateRecent = $false
    candidateFresh = $false
    candidateReady = $false
    processCount = 0
    matchingProcessCount = 0
    unknownPathProcessCount = 0
    allRunningProcessesMatchCandidate = $false
    overlayWindowCount = 0
    overlayMatchesDesktopShellProcess = $false
    safetyOk = $false
    scopeOk = $false
    privacyOk = $false
    sidecarProcessCount = 0
  }
}
$overlayVisualAttachSummary = if ($overlayVisualAttach -and $overlayVisualAttach.checks) {
  [pscustomobject]@{
    pass = [bool]$overlayVisualAttach.pass
    completionReady = [bool]$overlayVisualAttach.completionReady
    completionImpact = [string]$overlayVisualAttach.completionImpact
    windowCount = if ($null -ne $overlayVisualAttach.windowCount) { [int]$overlayVisualAttach.windowCount } else { 0 }
    windowFound = [bool]$overlayVisualAttach.checks.overlayWindowFound
    windowVisible = [bool]$overlayVisualAttach.checks.overlayWindowVisible
    noActivateStyle = [bool]$overlayVisualAttach.checks.noActivateStyle
    geometryMatchesExpectedOverlaySize = [bool]$overlayVisualAttach.checks.geometryMatchesExpectedOverlaySize
    screenPixelsCapturedForRatios = [bool]$overlayVisualAttach.checks.screenPixelsCapturedForRatios
    largeWhiteBlockAbsent = [bool]$overlayVisualAttach.checks.largeWhiteBlockAbsent
    screenshotSaved = [bool]$overlayVisualAttach.checks.screenshotSaved
    safetyOk = [bool](
      $overlayVisualAttach.safety -and
      $overlayVisualAttach.safety.attachOnly -and
      -not $overlayVisualAttach.safety.processStartAttempted -and
      -not $overlayVisualAttach.safety.stopAttempted -and
      -not $overlayVisualAttach.safety.killAttempted -and
      -not $overlayVisualAttach.safety.replaceAttempted -and
      -not $overlayVisualAttach.safety.realOverlayClickAttempted -and
      -not $overlayVisualAttach.safety.targetWriteAttempted
    )
    privacyOk = [bool](
      $overlayVisualAttach.privacy -and
      $overlayVisualAttach.privacy.noPromptTextRead -and
      $overlayVisualAttach.privacy.noTargetInputRead -and
      $overlayVisualAttach.privacy.noRawTitlesStored -and
      $overlayVisualAttach.privacy.rawUiaNamesNotRead -and
      $overlayVisualAttach.privacy.clipboardTextNotRead -and
      (-not $overlayVisualAttach.privacy.rawDesktopPixelsPersisted) -and
      $overlayVisualAttach.privacy.onlyMetadataStored
    )
  }
} else {
  [pscustomobject]@{
    pass = $false
    completionReady = $false
    completionImpact = ""
    windowCount = 0
    windowFound = $false
    windowVisible = $false
    noActivateStyle = $false
    geometryMatchesExpectedOverlaySize = $false
    screenPixelsCapturedForRatios = $false
    largeWhiteBlockAbsent = $false
    screenshotSaved = $false
    safetyOk = $false
    privacyOk = $false
  }
}
$transparentReleaseExeReportMatch = [bool](
  $overlayNoActivate -and
  $overlayNoActivate.releaseExe -and
  (Resolve-RepoPath $overlayNoActivate.releaseExe) -ieq $overlayTransparentReleasePath
)
$transparentReleaseRecentThresholdUtc = (Get-Date).ToUniversalTime().AddDays(-45)
$transparentReleaseCandidateFresh = [bool](
  $transparentReleaseExePresent -and
  $transparentReleaseExeTime -and
  $transparentReleaseSourceTime -and
  $transparentReleaseExeTime -ge $transparentReleaseSourceTime
)
$transparentReleaseCandidateRecent = [bool](
  $transparentReleaseExePresent -and
  $transparentReleaseExeTime -and
  $transparentReleaseExeTime -ge $transparentReleaseRecentThresholdUtc
)
$transparentReleaseCandidateReady = [bool](
  $transparentReleaseExePresent -and
  $transparentReleaseExeSize -and
  $transparentReleaseExeSize -gt 0 -and
  $transparentReleaseCandidateFresh -and
  $transparentReleaseCandidateRecent
)
$overlayNoActivateReportFresh = [bool](
  $overlayNoActivateReportTime -and
  $overlayRuntimeSourceTime -and
  $overlayNoActivateReportTime -ge $overlayRuntimeSourceTime
)
$overlayVisualAttachReportFresh = [bool](
  $overlayVisualAttachReportTime -and
  (
    (-not $runtimeReadinessReportTime) -or
    $overlayVisualAttachReportTime -ge $runtimeReadinessReportTime
  )
)

$mascotAssets = @(
  "apps/desktop-shell/src/assets/mascot-states/normal.png",
  "apps/desktop-shell/src/assets/mascot-states/resting.png",
  "apps/desktop-shell/src/assets/mascot-states/thinking.png",
  "apps/desktop-shell/src/assets/mascot-states/suggesting.png",
  "apps/desktop-shell/src/assets/mascot-states/success.png",
  "apps/desktop-shell/src/assets/mascot-states/clapping.png"
)
$missingAssets = @($mascotAssets | Where-Object { -not (Test-Path -LiteralPath (Resolve-RepoPath $_)) })

$staticChecks = [ordered]@{
  overlayFilesPresent = [bool](
    (Test-Path -LiteralPath (Resolve-RepoPath "apps/desktop-shell/overlay.html")) -and
    (Test-Path -LiteralPath (Resolve-RepoPath "apps/desktop-shell/src/overlay.js")) -and
    (Test-Path -LiteralPath (Resolve-RepoPath "apps/desktop-shell/src/overlay.css"))
  )
  mascotAssetsPresent = [bool]($missingAssets.Count -eq 0)
  overlayHtmlUsesMascotButton = [bool](Test-TextContains $overlayHtml "mascot-overlay-button")
  overlayHtmlBootstrapsTransparentCompact = [bool](
    (Test-TextContains $overlayHtml 'data-state="resting"') -and
    (Test-TextContains $overlayHtml 'data-overlay-mode="compact"') -and
    (Test-TextContains $overlayHtml "background: rgba(0, 0, 0, 0)") -and
    (Test-TextContains $overlayHtml 'html[data-overlay-mode="compact"] #mascot-overlay-badge') -and
    (Test-TextContains $overlayHtml "font-size: 0") -and
    (Test-TextContains $overlayHtml "box-shadow: 0 0 0 4px")
  )
  desktopDistHasTransparentCompactOverlay = [bool](
    (Test-TextContains $distOverlayHtml 'data-overlay-mode="compact"') -and
    (Test-TextContains $distOverlayHtml 'html[data-overlay-mode="compact"] #mascot-overlay-badge') -and
    (Test-TextContains $distOverlayHtml "font-size: 0") -and
    (Test-TextContains $distOverlayHtml "box-shadow: 0 0 0 4px") -and
    (Test-TextContains $distOverlayCss 'html[data-overlay-mode="compact"]') -and
    (Test-TextContains $distOverlayCss "background: transparent") -and
    (Test-TextContains $distOverlayJs "visualOnly")
  )
  overlayChatBubblePresent = [bool](
    (Test-TextContains $overlayHtml "mascot-overlay-card") -and
    (Test-TextContains $overlayHtml "mascot-overlay-chat") -and
    (Test-TextContains $overlayHtml "mascot-overlay-message") -and
    (Test-TextContains $overlayHtml "mascot-overlay-meta") -and
    (Test-TextContains $overlayHtml "mascot-overlay-hint") -and
    (Test-TextContains $overlayHtml "mascot-overlay-turns") -and
    (Test-TextContains $overlayHtml "mascot-overlay-user-turn") -and
    (Test-TextContains $overlayHtml "mascot-overlay-assistant-turn") -and
    (Test-TextContains $overlayHtml "mascot-overlay-primary") -and
    (Test-TextContains $overlayHtml "mascot-overlay-close") -and
    (Test-TextContains $overlayHtml "mascot-overlay-draft") -and
    (Test-TextContains $overlayHtml "mascot-overlay-draft-form") -and
    (Test-TextContains $overlayHtml "mascot-overlay-draft-input") -and
    (Test-TextContains $overlayHtml "<textarea") -and
    (Test-TextContains $overlayHtml 'rows="2"') -and
    (Test-TextContains $overlayHtml "mascot-overlay-draft-send") -and
    (Test-TextContains $overlayHtml "&gt;") -and
    (Test-TextContains $overlayHtml "mascot-overlay-replies") -and
    (Test-TextContains $overlayHtml "mascot-overlay-reply-short") -and
    (Test-TextContains $overlayHtml "mascot-overlay-reply-clear") -and
    (Test-TextContains $overlayHtml "mascot-overlay-reply-steps") -and
    (Test-TextContains $overlayHtml "mascot-overlay-generate") -and
    (Test-TextContains $overlayHtml "mascot-overlay-refresh") -and
    (Test-TextContains $overlayHtml "mascot-overlay-mode-idea") -and
    (Test-TextContains $overlayHtml "mascot-overlay-mode-continue") -and
    (Test-TextContains $overlayHtml "mascot-overlay-mode-polish")
  )
  overlayCompactBubblePresent = [bool](
    (Test-TextContains $overlayHtml "width: 72px") -and
    (Test-TextContains $overlayCss "place-items: center") -and
    (Test-TextContains $overlayCss "grid-template-columns: 1fr") -and
    (Test-TextContains $overlayCss "gap: 0") -and
    (Test-TextContains $overlayCss 'html[data-overlay-mode="compact"] .mascot-overlay-chat') -and
    (Test-TextContains $overlayCss "display: none") -and
    (Test-TextContains $overlayCss "animation: none") -and
    (Test-TextContains $overlayCss "transform: none") -and
    (Test-TextContains $overlayCss "box-shadow: 0 0 0 4px") -and
    (Test-TextContains $overlayCss "font-size: 0") -and
    (Test-TextContains $appSource "DESKTOP_OVERLAY_COMPACT_SIZE = { width: 72, height: 72 }") -and
    (Test-TextContains $tauriMain "MASCOT_OVERLAY_COMPACT_WIDTH: f64 = 72.0")
  )
  overlayCompactBackdropHardening = [bool](
    (Test-TextContains $overlayHtml "max-width: 72px") -and
    (Test-TextContains $overlayHtml "background: rgba(0, 0, 0, 0) !important") -and
    (Test-TextContains $overlayCss "background: transparent !important") -and
    (Test-TextContains $overlayCss "contain: strict") -and
    (Test-TextContains $overlayCss "clip-path: inset(0)") -and
    (Test-TextContains $tauriMain ".transparent(true)") -and
    (Test-TextContains $tauriMain "MASCOT_OVERLAY_TRANSPARENT_COLOR") -and
    (Test-TextContains $tauriMain ".background_color(MASCOT_OVERLAY_TRANSPARENT_COLOR)") -and
    (Test-TextContains $tauriMain "set_background_color(Some(MASCOT_OVERLAY_TRANSPARENT_COLOR))") -and
    (Test-TextContains $tauriMain ".shadow(false)")
  )
  overlayJsCallsMascotClicked = [bool](Test-TextContains $overlayJs "mascot_overlay_clicked")
  overlaySupportsCompactExpandedModes = [bool](
    (Test-TextContains $overlayJs "overlayMode") -and
    (Test-TextContains $overlayJs "set_mascot_overlay_state") -and
    (Test-TextContains $tauriMain "MASCOT_OVERLAY_COMPACT_WIDTH") -and
    (Test-TextContains $tauriMain "apply_mascot_overlay_geometry") -and
    (Test-TextContains $tauriMain ".transparent(true)")
  )
  overlaySupportsActionTokens = [bool](
    (Test-TextContains $overlayJs "overlayAction") -and
    (Test-TextContains $overlayJs "getOverlayHint") -and
    (Test-TextContains $overlayJs "getConversationTurns") -and
    (Test-TextContains $overlayJs "userTurn") -and
    (Test-TextContains $overlayJs "assistantTurn") -and
    (Test-TextContains $overlayJs "Smart: opening draft") -and
    (Test-TextContains $overlayJs "Smart: scanning target") -and
    (Test-TextContains $overlayJs "handleQuickDraftKeydown") -and
    (Test-TextContains $overlayJs "event.shiftKey") -and
    (Test-TextContains $overlayJs "escape-collapse") -and
    (Test-TextContains $overlayJs "accelerator-send") -and
    (Test-TextContains $overlayJs "quickDraftPending") -and
    (Test-TextContains $overlayJs "quickDraftSendReady") -and
    (Test-TextContains $overlayCss ".mascot-overlay-secondary:disabled") -and
    (Test-TextContains $overlayCss ".mascot-overlay-mode:disabled") -and
    (Test-TextContains $overlayCss ".mascot-overlay-reply:disabled") -and
    (Test-TextContains $overlayCss ".mascot-overlay-draft-send:disabled") -and
    (Test-TextContains $overlayJs "generateButton") -and
    (Test-TextContains $overlayJs "applyQuickReply") -and
    (Test-TextContains $overlayJs "quickReplyCount") -and
    (Test-TextContains $overlayJs "mascot_overlay_draft_submitted") -and
    (Test-TextContains $overlayJs "outcome-good") -and
    (Test-TextContains $overlayJs "outcome-fix") -and
    (Test-TextContains $appSource "handleMascotOverlayDraftSubmission") -and
    (Test-TextContains $appSource "handleMascotOverlayOutcome") -and
    (Test-TextContains $appSource "overlayOutcome") -and
    (Test-TextContains $appSource "revisionRequested") -and
    (Test-TextContains $appSource "smart-prompt-overlay-draft") -and
    (Test-TextContains $overlayJs "promptMode") -and
    (Test-TextContains $appSource "getMascotOverlayAction") -and
    (Test-TextContains $appSource "setDesktopPromptMode") -and
    (Test-TextContains $appSource "showDesktopPromptEditorFromOverlay") -and
    (Test-TextContains $tauriMain "overlay_action") -and
    (Test-TextContains $tauriMain "prompt_mode") -and
    (Test-TextContains $tauriMain "mascot_overlay_draft_submitted")
  )
  overlayPayloadCarriesPromptReadiness = [bool](
    (Test-TextContains $appSource "getDesktopPromptOverlayMeta") -and
    (Test-TextContains $appSource "promptReady") -and
    (Test-TextContains $appSource "promptKind") -and
    (Test-TextContains $tauriMain "prompt_ready") -and
    (Test-TextContains $tauriMain "prompt_kind")
  )
  overlayChatShowsGuardFeedback = [bool](
    (Test-TextContains $appSource "showDesktopMascotOverlayGuard") -and
    (Test-TextContains $appSource "guardReason") -and
    (Test-TextContains $overlayJs "Guarded") -and
    (Test-TextContains $tauriMain "guard_reason")
  )
  autoDetectBootstrapsOnAppLoad = [bool](
    (Test-TextContains $appSource "startDesktopOverlayAutoDetect();") -and
    (Test-TextContains $appSource "window.__smartPromptOverlayAutoDetectReady = true")
  )
  autoDetectStartsLocalService = [bool](
    (Test-TextContains $appSource "function startDesktopOverlayAutoDetect") -and
    (Test-TextContains $appSource 'invoke("start_local_service")')
  )
  sidecarLaunchesFromRuntimeCopy = [bool](
    (Test-TextContains $tauriMain "prepare_local_service_sidecar_for_execution") -and
    (Test-TextContains $tauriMain 'sidecar.source != "bundled"') -and
    (Test-TextContains $tauriMain 'join("sidecar-runtime")') -and
    (Test-TextContains $tauriMain "sidecar_runtime_fingerprint") -and
    (Test-TextContains $tauriMain 'source: "bundled-runtime"') -and
    (Test-TextContains $tauriMain "copy_dir_if_changed") -and
    (Test-TextContains $tauriMain "copy_file_if_changed")
  )
  desktopShellStartVerifierPresent = [bool](
    (Test-TextContains $desktopShellStartProbe "p25-desktop-shell-start@1") -and
    (Test-TextContains $desktopShellStartProbe "AllowStartDesktopShell") -and
    (Test-TextContains $desktopShellStartProbe "Start-Process") -and
    (Test-TextContains $desktopShellStartProbe "startRequiresExplicitAllow") -and
    (Test-TextContains $desktopShellStartProbe "realOverlayClickAttempted") -and
    (Test-TextContains $desktopShellStartProbe "writeAttempted")
  )
  desktopShellStartDiagnosticsPresent = [bool](
    (Test-TextContains $desktopShellStartProbe "existingProcessBlocksStart") -and
    (Test-TextContains $desktopShellStartProbe "safeToStartWithoutStoppingExisting") -and
    (Test-TextContains $desktopShellStartProbe "nextAction")
  )
  desktopShellStartVerifierNoStopOrKill = [bool](
    (Test-TextContains $desktopShellStartProbe 'stopAttempted = $false') -and
    (Test-TextContains $desktopShellStartProbe 'killAttempted = $false') -and
    (Test-TextContains $desktopShellStartProbe 'replaceAttempted = $false') -and
    -not (Test-TextContains $desktopShellStartProbe "Stop-Process") -and
    -not (Test-TextContains $desktopShellStartProbe "taskkill")
  )
  desktopShellVisualRuntimeVerifierPresent = [bool](
    (Test-TextContains $desktopShellVisualRuntimeProbe "p25-desktop-shell-visual-runtime@1") -and
    (Test-TextContains $desktopShellVisualRuntimeProbe "AllowStartDesktopShell") -and
    (Test-TextContains $desktopShellVisualRuntimeProbe "OverlayVisualAttachReport") -and
    (Test-TextContains $desktopShellVisualRuntimeProbe "verifiesVisualRuntimeOnly")
  )
  desktopShellVisualRuntimeNoRealClickOrFill = [bool](
    (Test-TextContains $desktopShellVisualRuntimeProbe 'realOverlayClickAttempted = $false') -and
    (Test-TextContains $desktopShellVisualRuntimeProbe 'foregroundFillAttempted = $false') -and
    (Test-TextContains $desktopShellVisualRuntimeProbe 'fillLatestReadAttempted = $false') -and
    (Test-TextContains $desktopShellVisualRuntimeProbe 'doesNotPollLatestFill = $true') -and
    -not (Test-TextContains $desktopShellVisualRuntimeProbe "AllowRealOverlayClick") -and
    -not (Test-TextContains $desktopShellVisualRuntimeProbe "/desktop/fill/latest") -and
    -not (Test-TextContains $desktopShellVisualRuntimeProbe "/desktop/fill")
  )
  autoDetectPollsSnapshot = [bool](
    (Test-TextContains $appSource "/desktop/input-snapshot") -and
    (Test-TextContains $appSource "DESKTOP_OVERLAY_POLL_MS = 500") -and
    (Test-TextContains $appSource "scheduleDesktopOverlaySnapshotPoll") -and
    (Test-TextContains $appSource "DESKTOP_OVERLAY_MAX_BACKOFF_MS")
  )
  overlayTransientKeepRequiresEligibleProfile = [bool](
    (Test-TextContains $appSource "canKeepDesktopOverlayDuringTransientMiss") -and
    (Test-TextContains $appSource "if (!readiness?.overlayEligible) return false") -and
    (Test-TextContains $interactionTest "transient desktop miss") -and
    (Test-TextContains $interactionTest 'command, "hide_mascot_overlay"')
  )
  autoDetectDoesInitialRefresh = [bool](
    (Test-TextContains $appSource "refreshDesktopOverlaySnapshot().catch((error)") -and
    (Test-TextContains $appSource 'warnAsyncFailure("desktop-overlay-initial-snapshot"')
  )
  overlayRestrictedToTargets = [bool](Test-TextContains $appSource 'new Set(["codex", "workbuddy", "trae"])')
  overlayRequiresReadiness = [bool]((Test-TextContains $overlayRuntimeSource "overlayReady") -and (Test-TextContains $overlayRuntimeSource "safeCandidateCount <= 0"))
  overlayPayloadUsesSafeCandidateIndex = [bool]((Test-TextContains $appSource "candidateIndex: readiness.bestCandidateIndex") -and (Test-TextContains $appSource "titleHash: readiness.titleHash"))
  overlayPlacementUsesSafeCandidateIndex = [bool](
    (Test-TextContains $overlayRuntimeSource "getDesktopOverlayCandidate(snapshot, readiness)") -and
    (Test-TextContains $overlayRuntimeSource "Number(candidate.index) === bestCandidateIndex") -and
    (Test-TextContains $interactionTest "desktop overlay multi-candidate reposition") -and
    (Test-TextContains $interactionTest "candidateIndex, 1")
  )
  overlayVisualAnchorDoesNotEnableFill = [bool](
    (Test-TextContains $appSource "isDesktopOverlayVisualAnchorCandidate") -and
    (Test-TextContains $appSource "getDesktopOverlayVisualAnchor") -and
    (Test-TextContains $appSource "visualAnchorReason") -and
    (Test-TextContains $appSource "browserLikeComposerCandidateCount") -and
    (Test-TextContains $appSource "visualOnly") -and
    (Test-TextContains $appSource "payload.visualOnly !== true") -and
    (Test-TextContains $overlayJs "visualAnchorReason") -and
    (Test-TextContains $overlayJs "browserLikeComposerCandidateCount") -and
    (Test-TextContains $overlayJs "Focus input, then Scan") -and
    (Test-TextContains $interactionTest "visual-only overlay click guard hide")
  )
  overlayClickBridge = [bool]((Test-TextContains $appSource "smart-prompt-overlay-click") -and (Test-TextContains $tauriMain "mascot_overlay_clicked"))
  overlayClickRequiresPayload = [bool](Test-TextContains $appSource "if (!payload) return false")
  overlayClickRequiresNoAutoSubmit = [bool](Test-TextContains $appSource "payload.noAutoSubmit === true")
  overlayClickRequiresFillAction = [bool](
    (Test-TextContains $appSource 'if (!overlayAction)') -and
    (Test-TextContains $appSource 'if (overlayAction !== "fill")') -and
    (Test-TextContains $interactionTest "missing fill action guard hide")
  )
  overlayClickRequiresProfileTitleCandidate = [bool](
    (Test-TextContains $appSource "String(payload.profile") -and
    (Test-TextContains $appSource "String(payload.titleHash") -and
    (Test-TextContains $appSource "Number(payload.candidateIndex)")
  )
  overlayClickOpensDraftWhenPromptMissing = [bool](
    (Test-TextContains $appSource "showDesktopPromptDraftFromOverlay") -and
    (Test-TextContains $appSource "show_main_window") -and
    (Test-TextContains $appSource "desktopDraftInput?.focus") -and
    (Test-TextContains $appSource 'dataset.fusionState = "needs-draft"') -and
    (Test-TextContains $interactionTest "overlay click needs draft recovery")
  )
  desktopPromptHandoffShowsReadiness = [bool](
    (Test-TextContains $desktopHtml "desktop-prompt-handoff") -and
    (Test-TextContains $appSource "renderDesktopPromptHandoff") -and
    (Test-TextContains $appSource 'dataset.handoffState') -and
    (Test-TextContains $appSource 'dataset.handoffAction') -and
    (Test-TextContains $appSource 'desktopPromptHandoffFocusInput') -and
    (Test-TextContains $appSource 'desktopPromptHandoffClickMascot') -and
    (Test-TextContains $appSource 'dataset.promptReady') -and
    (Test-TextContains $interactionTest 'dataset.handoffAction, "focus-input"') -and
    (Test-TextContains $interactionTest 'dataset.handoffAction, "click-mascot"') -and
    (Test-TextContains $interactionTest 'dataset.handoffState, "ready"')
  )
  fillUsesForegroundGuard = [bool](
    (Test-TextContains $appSource "/desktop/fill") -and
    (Test-TextContains $appSource "confirmForeground: true") -and
    (Test-TextContains $appSource "expectedTitleHash") -and
    (Test-TextContains $appSource "expectedToolProfile")
  )
  nativeOverlayNoActivate = [bool](
    (Test-TextContains $tauriMain "WS_EX_NOACTIVATE") -and
    (Test-TextContains $tauriMain "SWP_NOACTIVATE") -and
    (Test-TextContains $tauriMain "show_overlay_without_activation")
  )
  desktopShellSyncsPromptState = [bool](
    (Test-TextContains $appSource "/desktop/prompt-state") -and
    (Test-TextContains $appSource "buildDesktopPromptStatePayload") -and
    (Test-TextContains $appSource "noAutoSubmit: true")
  )
  interactionTestCoversAutoShow = [bool](Test-TextContains $interactionTest "desktop overlay auto show")
  interactionTestCoversMissingPayloadBlock = [bool](Test-TextContains $interactionTest "payload: null")
  interactionTestCoversStalePayloadBlock = [bool](Test-TextContains $interactionTest "stale-title-hash")
  interactionTestCoversValidOverlayFill = [bool](Test-TextContains $interactionTest "overlay click foreground fill")
  interactionTestCoversCodexNoSafeCandidate = [bool](Test-TextContains $interactionTest "codex guarded candidate")
  interactionTestCoversOverlayRetry = [bool](
    (Test-TextContains $interactionTest "overlay retry generation") -and
    (Test-TextContains $interactionTest "showMainCountBeforeRetryOverlayAction") -and
    (Test-TextContains $interactionTest "fillRequestsBeforeRetryOverlayAction")
  )
  realOverlayClickVerifierPresent = [bool](Test-TextContains $realOverlayClickProbe "p25-real-overlay-click-fill@1")
  realOverlayClickRequiresExplicitAllow = [bool](Test-TextContains $realOverlayClickProbe "AllowRealOverlayClick")
  realOverlayClickRequiresPreparedPrompt = [bool]((Test-TextContains $realOverlayClickProbe "/desktop/prompt-state") -and (Test-TextContains $realOverlayClickProbe "desktopPromptStateReady"))
  realOverlayClickPollsLatestFill = [bool](Test-TextContains $realOverlayClickProbe "/desktop/fill/latest")
  realOverlayClickSupportsCompactExpand = [bool](
    (Test-TextContains $realOverlayClickProbe "compact_expand_then_primary_click_sent") -and
    (Test-TextContains $realOverlayClickProbe "Send-MascotOverlayPrimaryClick")
  )
  composerDiagnosticsVerifierPresent = [bool](Test-TextContains $composerDiagnosticsProbe "p25-composer-candidate-diagnostics@1")
  composerDiagnosticsOnlyUsesSanitizedSignals = [bool]((Test-TextContains $composerDiagnosticsProbe "onlyHashesGeometryAndBooleans") -and (Test-TextContains $composerDiagnosticsProbe "elementValuesNotRead"))
  overlayChatVisualVerifierPresent = [bool](
    (Test-TextContains $overlayChatVisualProbe "p25-overlay-chat-visual@2") -and
    (Test-TextContains $overlayChatVisualProbe "sharedCardContract") -and
    (Test-TextContains $overlayChatVisualProbe "canonicalStatesCovered") -and
    (Test-TextContains $overlayChatVisualProbe "guardedFillRouting") -and
    (Test-TextContains $overlayChatVisualProbe "regenerateRouting") -and
    (Test-TextContains $overlayChatVisualProbe "modeRouting") -and
    (Test-TextContains $overlayChatVisualProbe "initialCompactProbe") -and
    (Test-TextContains $overlayChatVisualProbe "largeWhiteBlockAbsent") -and
    (Test-TextContains $overlayChatVisualProbe "compactBackdropTransparent") -and
    (Test-TextContains $overlayChatVisualProbe "compactScreenshotTransparent") -and
    (Test-TextContains $overlayChatVisualProbe "screenshotTransparency") -and
    (Test-TextContains $overlayChatVisualProbe "reportStoresOnlyPromptLength") -and
    (Test-TextContains $overlayChatVisualProbe "overlayUsesMetadataOnly")
  )
  overlayWindowVisualAttachVerifierPresent = [bool](
    (Test-TextContains $overlayVisualAttachProbe "p25-overlay-window-visual-attach@1") -and
    (Test-TextContains $overlayVisualAttachProbe "FindMascotWindows") -and
    (Test-TextContains $overlayVisualAttachProbe "CopyFromScreen") -and
    (Test-TextContains $overlayVisualAttachProbe "TimeoutSeconds") -and
    (Test-TextContains $overlayVisualAttachProbe "pollCount") -and
    (Test-TextContains $overlayVisualAttachProbe "AllowScreenshot") -and
    (Test-TextContains $overlayVisualAttachProbe "largeWhiteBlockAbsent")
  )
  overlayWindowVisualAttachVerifierNoStartOrClick = [bool](
    (Test-TextContains $overlayVisualAttachProbe 'processStartAttempted = $false') -and
    (Test-TextContains $overlayVisualAttachProbe 'realOverlayClickAttempted = $false') -and
    (Test-TextContains $overlayVisualAttachProbe 'targetWriteAttempted = $false') -and
    (Test-TextContains $overlayVisualAttachProbe 'screenshotWriteRequiresExplicitAllow = $true')
  )
  desktopDraftCdpPreparationIsDomOnly = [bool](
    (Test-TextContains $desktopDraftCdpPrep "p25-desktop-shell-draft-cdp@1") -and
    (Test-TextContains $desktopDraftCdpPrep 'document.getElementById("desktop-draft-input")') -and
    (Test-TextContains $desktopDraftCdpPrep "syncDesktopPromptState") -and
    (Test-TextContains $desktopDraftCdpPrep "draftTextNotStored") -and
    -not (Test-TextContains $desktopDraftCdpPrep 'postJson') -and
    -not (Test-TextContains $desktopDraftCdpPrep 'method: "POST"')
  )
  localServiceStoresLatestFill = [bool]((Test-TextContains $localService "m3-desktop-fill-latest@1") -and (Test-TextContains $localService "/desktop/fill/latest"))
  sidecarStoresLatestFill = [bool]((Test-TextContains $sidecar "m3-desktop-fill-latest@1") -and (Test-TextContains $sidecar "/desktop/fill/latest"))
  localServiceStoresPromptState = [bool]((Test-TextContains $localService "p25-desktop-prompt-state@1") -and (Test-TextContains $localService "/desktop/prompt-state"))
  sidecarStoresPromptState = [bool]((Test-TextContains $sidecar "p25-desktop-prompt-state@1") -and (Test-TextContains $sidecar "/desktop/prompt-state"))
  sidecarHandlesRequestsConcurrently = [bool]((Test-TextContains $sidecar "thread::spawn") -and (Test-TextContains $sidecar "handle_request(request"))
}

$staticPass = -not @($staticChecks.GetEnumerator() | Where-Object { -not $_.Value }).Count

$targetSummary = Get-ReportSummary $targets
$writeGuardSummary = Get-ReportSummary $writeGuard

$runtimeChecks = [ordered]@{
  overlayNoActivateReportPresent = [bool]($overlayNoActivate -ne $null)
  overlayNoActivatePass = [bool]($overlayNoActivate -and $overlayNoActivate.pass -and $overlayNoActivate.checks.noActivateStyle)
  overlayNoActivateReportFresh = [bool]$overlayNoActivateReportFresh
  overlayVisualAttachReportPresent = [bool]($overlayVisualAttach -ne $null)
  overlayVisualAttachPass = [bool]($overlayVisualAttachSummary.pass)
  overlayVisualAttachReportFresh = [bool]$overlayVisualAttachReportFresh
  overlayVisualAttachWindowFound = [bool]$overlayVisualAttachSummary.windowFound
  overlayVisualAttachWindowCount = [int]$overlayVisualAttachSummary.windowCount
  overlayVisualAttachNoActivateStyle = [bool]$overlayVisualAttachSummary.noActivateStyle
  overlayVisualAttachGeometryOk = [bool]$overlayVisualAttachSummary.geometryMatchesExpectedOverlaySize
  overlayVisualAttachLargeWhiteBlockAbsent = [bool]$overlayVisualAttachSummary.largeWhiteBlockAbsent
  overlayVisualAttachScreenshotSaved = [bool]$overlayVisualAttachSummary.screenshotSaved
  overlayVisualAttachSafetyOk = [bool]$overlayVisualAttachSummary.safetyOk
  overlayVisualAttachPrivacyOk = [bool]$overlayVisualAttachSummary.privacyOk
  transparentReleaseCandidatePresent = [bool]$transparentReleaseExePresent
  transparentReleaseCandidateFresh = [bool]$transparentReleaseCandidateFresh
  transparentReleaseCandidateRecent = [bool]$transparentReleaseCandidateRecent
  transparentReleaseCandidateMatchesNoActivateReport = [bool]$transparentReleaseExeReportMatch
  transparentReleaseCandidateReady = [bool]$transparentReleaseCandidateReady
  runtimeReadinessReportPresent = [bool]($runtimeReadiness -ne $null)
  runtimeReadinessPass = [bool]$runtimeReadinessSummary.pass
  runtimeReadinessCompletionReady = [bool]$runtimeReadinessSummary.completionReady
  runtimeReadinessCandidateFound = [bool]$runtimeReadinessSummary.candidateFound
  runtimeReadinessCandidateRecent = [bool]$runtimeReadinessSummary.candidateRecent
  runtimeReadinessCandidateFresh = [bool]$runtimeReadinessSummary.candidateFresh
  runtimeReadinessCandidateReady = [bool]$runtimeReadinessSummary.candidateReady
  runtimeReadinessProcessMatch = [bool]$runtimeReadinessSummary.allRunningProcessesMatchCandidate
  runtimeReadinessProcessCount = [int]$runtimeReadinessSummary.processCount
  runtimeReadinessMatchingProcessCount = [int]$runtimeReadinessSummary.matchingProcessCount
  runtimeReadinessUnknownPathProcessCount = [int]$runtimeReadinessSummary.unknownPathProcessCount
  runtimeReadinessOverlayWindowCount = [int]$runtimeReadinessSummary.overlayWindowCount
  runtimeReadinessOverlayMatchesDesktopShellProcess = [bool]$runtimeReadinessSummary.overlayMatchesDesktopShellProcess
  runtimeReadinessSafetyOk = [bool]$runtimeReadinessSummary.safetyOk
  runtimeReadinessScopeOk = [bool]$runtimeReadinessSummary.scopeOk
  runtimeReadinessPrivacyOk = [bool]$runtimeReadinessSummary.privacyOk
  runtimeReadinessSidecarProcessCount = [int]$runtimeReadinessSummary.sidecarProcessCount
  desktopShellStartReportPresent = [bool]($desktopShellStart -ne $null)
  desktopShellStartRequiresExplicitAllow = [bool](
    $desktopShellStart -and
    $desktopShellStart.safety -and
    $desktopShellStart.safety.startRequiresExplicitAllow
  )
  desktopShellStartSafetyOk = [bool](
    $desktopShellStart -and
    $desktopShellStart.safety -and
    $desktopShellStart.safety.startRequiresExplicitAllow -and
    ((-not $desktopShellStart.safety.startAttempted) -or $desktopShellStart.safety.startAllowed) -and
    (-not $desktopShellStart.safety.stopAttempted) -and
    (-not $desktopShellStart.safety.killAttempted) -and
    (-not $desktopShellStart.safety.replaceAttempted) -and
    (-not $desktopShellStart.safety.realOverlayClickAttempted) -and
    (-not $desktopShellStart.safety.writeAttempted)
  )
  desktopShellStartPrivacyOk = [bool](
    $desktopShellStart -and
    $desktopShellStart.privacy -and
    $desktopShellStart.privacy.noPromptTextRead -and
    $desktopShellStart.privacy.noTargetInputRead -and
    $desktopShellStart.privacy.noRawTitlesRead -and
    $desktopShellStart.privacy.rawUiaNamesNotRead -and
    $desktopShellStart.privacy.clipboardTextNotRead -and
    $desktopShellStart.privacy.onlyMetadataStored
  )
  desktopShellStartCompletionReady = [bool]($desktopShellStart -and $desktopShellStart.completionReady)
  desktopShellStartExistingProcessBlocksStart = [bool]($desktopShellStart -and $desktopShellStart.diagnostics -and $desktopShellStart.diagnostics.existingProcessBlocksStart)
  desktopShellStartSafeToStartWithoutStoppingExisting = [bool]($desktopShellStart -and $desktopShellStart.diagnostics -and $desktopShellStart.diagnostics.safeToStartWithoutStoppingExisting)
  targetsReportPresent = [bool]($targets -ne $null)
  targetsPrivacyOk = [bool]($targetSummary.privacyOk -and $targetSummary.noAutoSubmit)
  targetsStrictForegroundReady = [bool]($targetSummary.profileCount -gt 0 -and $targetSummary.strictForegroundDetectedCount -eq $targetSummary.profileCount)
  targetsSafeCandidatesReady = [bool]($targetSummary.profileCount -gt 0 -and $targetSummary.safeCandidateTargetCount -eq $targetSummary.profileCount)
  targetsWritesVerified = [bool]($targetSummary.profileCount -gt 0 -and $targetSummary.writeVerifiedCount -eq $targetSummary.profileCount)
  writeGuardReportPresent = [bool]($writeGuard -ne $null)
  writeGuardPrivacyOk = [bool]($writeGuardSummary.privacyOk -and $writeGuardSummary.noAutoSubmit)
  writeGuardDoesNotWriteWithoutTarget = [bool](
    $writeGuard -and
    $writeGuard.allowForegroundWrite -and
    (
      $writeGuardSummary.strictForegroundDetectedCount -gt 0 -or
      $writeGuardSummary.writeAttemptedCount -eq 0
    )
  )
  realOverlayClickReportPresent = [bool]($realOverlayClick -ne $null)
  realOverlayClickVerified = [bool]($realOverlayClick -and $realOverlayClick.pass -and $realOverlayClick.completionReady)
  realOverlayClickDesktopPromptStateReady = [bool]($realOverlayClick -and $realOverlayClick.prerequisites.desktopPromptStateReady)
  composerDiagnosticsReportPresent = [bool]($composerDiagnostics -ne $null)
  composerDiagnosticsPrivacyOk = [bool](
    $composerDiagnostics -and
    $composerDiagnostics.pass -and
    $composerDiagnostics.privacy.onlyHashesGeometryAndBooleans -and
    $composerDiagnostics.privacy.targetInputsNotStored
  )
  overlayChatVisualReportPresent = [bool]($overlayChatVisual -ne $null)
  overlayChatVisualPass = [bool]($overlayChatVisual -and $overlayChatVisual.pass)
  overlayChatVisualCompactBackdropOk = [bool](
    $overlayChatVisual -and
    ((@($overlayChatVisual.checks | Where-Object { $_.overlayMode -eq "compact" -and -not $_.compactBackdropTransparent })).Count -eq 0)
  )
  overlayChatVisualCompactScreenshotOk = [bool](
    $overlayChatVisual -and
    ((@($overlayChatVisual.checks | Where-Object { $_.overlayMode -eq "compact" -and -not $_.compactScreenshotTransparent })).Count -eq 0)
  )
  overlayChatVisualInitialCompactOk = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.initialCompactProbe -and
    $overlayChatVisual.initialCompactProbe.defaultCompact -and
    $overlayChatVisual.initialCompactProbe.compactBody -and
    $overlayChatVisual.initialCompactProbe.compactCard -and
    $overlayChatVisual.initialCompactProbe.compactButton -and
    $overlayChatVisual.initialCompactProbe.compactBadgeDot -and
    $overlayChatVisual.initialCompactProbe.compactChatHidden -and
    $overlayChatVisual.initialCompactProbe.compactBackdropTransparent -and
    $overlayChatVisual.initialCompactProbe.largeWhiteBlockAbsent
  )
  overlayChatVisualCompactThinkingOk = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.compactThinkingProbe -and
    $overlayChatVisual.compactThinkingProbe.state -eq "thinking" -and
    $overlayChatVisual.compactThinkingProbe.defaultCompact -and
    $overlayChatVisual.compactThinkingProbe.compactBody -and
    $overlayChatVisual.compactThinkingProbe.compactCard -and
    $overlayChatVisual.compactThinkingProbe.compactButton -and
    $overlayChatVisual.compactThinkingProbe.compactBadgeDot -and
    $overlayChatVisual.compactThinkingProbe.compactChatHidden -and
    $overlayChatVisual.compactThinkingProbe.compactBackdropTransparent -and
    $overlayChatVisual.compactThinkingProbe.largeWhiteBlockAbsent
  )
  overlayChatVisualWhiteBlockRegressionOk = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.whiteBlockRegressionProbe -and
    $overlayChatVisual.whiteBlockRegressionProbe.state -eq "thinking" -and
    $overlayChatVisual.whiteBlockRegressionProbe.defaultCompact -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactBody -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactCard -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactButton -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactBadgeDot -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactChatHidden -and
    $overlayChatVisual.whiteBlockRegressionProbe.compactBackdropTransparent -and
    $overlayChatVisual.whiteBlockRegressionProbe.largeWhiteBlockAbsent
  )
  overlayChatVisualVisualAnchorMetadataOk = [bool](
    $overlayChatVisual -and
    (@($overlayChatVisual.checks | Where-Object {
      $_.name -eq "visual-only-no-safe-candidate" -and
      [string]$_.browserLikeComposerCandidateCount -eq "1" -and
      [string]$_.visualAnchorIndex -ne "" -and
      [string]$_.visualAnchorIndex -ne "-1" -and
      [string]$_.visualAnchorReason -ne "" -and
      $_.browserLikeComposerCandidateCountMatches -and
      $_.visualAnchorIndexMatches -and
      $_.visualAnchorReasonMatches -and
      $_.visualOnlyMatches -and
      $_.noAutoSubmit
    })).Count -gt 0
  )
  overlayChatVisualQuickRepliesWork = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.quickReplyProbe -and
    $overlayChatVisual.quickReplyProbe.quickDraftValueLength -gt 0 -and
    $overlayChatVisual.quickReplyProbe.quickReplySelected -eq "brief" -and
    $overlayChatVisual.quickReplyProbe.message -eq "Drafting note" -and
    $overlayChatVisual.quickReplyProbe.hint -eq "Ready to send" -and
    $overlayChatVisual.quickReplyProbe.badge -eq "draft" -and
    $overlayChatVisual.quickReplyProbe.primary -eq "Send" -and
    $overlayChatVisual.quickReplyProbe.primaryAction -eq "send-draft" -and
    $overlayChatVisual.quickReplyProbe.userTurn -eq "You: Brief" -and
    $overlayChatVisual.quickReplyProbe.assistantTurn -eq "Smart: press Send" -and
    $overlayChatVisual.quickReplyProbe.quickReplySelectedLabel -eq "Brief" -and
    $overlayChatVisual.quickReplyProbe.textNotStored -and
    $overlayChatVisual.sendButtonProbe -and
    $overlayChatVisual.sendButtonProbe.sendGlyph -eq ">" -and
    $overlayChatVisual.sendButtonProbe.emptyDisabled -and
    $overlayChatVisual.sendButtonProbe.emptyReady -eq "false" -and
    $overlayChatVisual.sendButtonProbe.emptySubmittedCount -eq 0 -and
    (-not $overlayChatVisual.sendButtonProbe.filledDisabled) -and
    $overlayChatVisual.sendButtonProbe.filledReady -eq "true" -and
    $overlayChatVisual.sendButtonProbe.submittedCount -eq 1 -and
    $overlayChatVisual.sendButtonProbe.command -eq "mascot_overlay_draft_submitted" -and
    $overlayChatVisual.sendButtonProbe.submittedTextLength -gt 0 -and
    $overlayChatVisual.sendButtonProbe.overlayAction -eq "quick-draft" -and
    $overlayChatVisual.sendButtonProbe.promptKind -eq "draft" -and
    $overlayChatVisual.sendButtonProbe.promptReady -and
    $overlayChatVisual.sendButtonProbe.inputValueLength -eq 0 -and
    $overlayChatVisual.sendButtonProbe.textNotStored -and
    $overlayChatVisual.pendingActionProbe -and
    $overlayChatVisual.pendingActionProbe.quickDraftPending -eq "true" -and
    $overlayChatVisual.pendingActionProbe.primary -eq "Send" -and
    $overlayChatVisual.pendingActionProbe.primaryAction -eq "send-draft" -and
    @($overlayChatVisual.pendingActionProbe.disabledActions).Count -eq 3 -and
    (@($overlayChatVisual.pendingActionProbe.disabledActions | Where-Object { -not $_ }).Count -eq 0) -and
    @($overlayChatVisual.pendingActionProbe.disabledModes).Count -eq 3 -and
    (@($overlayChatVisual.pendingActionProbe.disabledModes | Where-Object { -not $_ }).Count -eq 0) -and
    @($overlayChatVisual.pendingActionProbe.disabledReplies).Count -eq 3 -and
    (@($overlayChatVisual.pendingActionProbe.disabledReplies | Where-Object { -not $_ }).Count -eq 0) -and
    $overlayChatVisual.pendingActionProbe.valueStableAfterLockedReplies -and
    $overlayChatVisual.pendingActionProbe.invokedCount -eq 0 -and
    $overlayChatVisual.pendingActionProbe.submittedTextCount -eq 0 -and
    $overlayChatVisual.pendingActionProbe.fillCommandCount -eq 0 -and
    $overlayChatVisual.pendingActionProbe.textNotStored -and
    $overlayChatVisual.modeReplyProbe -and
    $overlayChatVisual.modeReplyProbe.promptMode -eq "polish" -and
    $overlayChatVisual.modeReplyProbe.replyActions[0] -eq "Short" -and
    $overlayChatVisual.modeReplyProbe.replyActions[1] -eq "Tone" -and
    $overlayChatVisual.modeReplyProbe.replyActions[2] -eq "Clear" -and
    $overlayChatVisual.modeReplyProbe.userTurn -eq "You: Polish" -and
    $overlayChatVisual.modeReplyProbe.assistantTurn -eq "Smart: replies tuned" -and
    $overlayChatVisual.modeReplyProbe.command -eq "mascot_overlay_clicked" -and
    $overlayChatVisual.modeReplyProbe.overlayAction -eq "mode" -and
    $overlayChatVisual.modeReplyProbe.invokedPromptMode -eq "polish" -and
    $overlayChatVisual.modeReplyProbe.submittedTextCount -eq 0 -and
    $overlayChatVisual.modeReplyProbe.textNotStored -and
    $overlayChatVisual.contextualReplyProbe -and
    $overlayChatVisual.contextualReplyProbe.quickDraftValueLength -gt 0 -and
    $overlayChatVisual.contextualReplyProbe.quickReplySelected -eq "tone" -and
    $overlayChatVisual.contextualReplyProbe.message -eq "Drafting note" -and
    $overlayChatVisual.contextualReplyProbe.hint -eq "Ready to send" -and
    $overlayChatVisual.contextualReplyProbe.badge -eq "draft" -and
    $overlayChatVisual.contextualReplyProbe.primary -eq "Send" -and
    $overlayChatVisual.contextualReplyProbe.primaryAction -eq "send-draft" -and
    $overlayChatVisual.contextualReplyProbe.userTurn -eq "You: Tone" -and
    $overlayChatVisual.contextualReplyProbe.assistantTurn -eq "Smart: press Send" -and
    $overlayChatVisual.contextualReplyProbe.quickReplySelectedLabel -eq "Tone" -and
    $overlayChatVisual.contextualReplyProbe.textNotStored -and
    $overlayChatVisual.primarySendProbe -and
    $overlayChatVisual.primarySendProbe.submittedCount -eq 1 -and
    $overlayChatVisual.primarySendProbe.command -eq "mascot_overlay_draft_submitted" -and
    $overlayChatVisual.primarySendProbe.submittedTextLength -gt 0 -and
    $overlayChatVisual.primarySendProbe.overlayAction -eq "quick-draft" -and
    $overlayChatVisual.primarySendProbe.promptKind -eq "draft" -and
    $overlayChatVisual.primarySendProbe.promptReady -and
    $overlayChatVisual.primarySendProbe.inputValueLength -eq 0 -and
    $overlayChatVisual.primarySendProbe.userTurn -eq "You: draft sent" -and
    $overlayChatVisual.primarySendProbe.assistantTurn -eq "Smart: make next" -and
    $overlayChatVisual.primarySendProbe.textNotStored -and
    $overlayChatVisual.actionTurnProbe -and
    $overlayChatVisual.actionTurnProbe.draft.userTurn -eq "You: Draft" -and
    $overlayChatVisual.actionTurnProbe.draft.assistantTurn -eq "Smart: opening draft" -and
    $overlayChatVisual.actionTurnProbe.draft.overlayAction -eq "draft" -and
    $overlayChatVisual.actionTurnProbe.scan.userTurn -eq "You: Scan" -and
    $overlayChatVisual.actionTurnProbe.scan.assistantTurn -eq "Smart: scanning target" -and
    $overlayChatVisual.actionTurnProbe.scan.overlayAction -eq "refresh" -and
    $overlayChatVisual.actionTurnProbe.fill.userTurn -eq "You: Fill" -and
    $overlayChatVisual.actionTurnProbe.fill.assistantTurn -eq "Smart: checking target" -and
    $overlayChatVisual.actionTurnProbe.fill.overlayAction -eq "fill" -and
    $overlayChatVisual.actionTurnProbe.submittedTextCount -eq 0 -and
    $overlayChatVisual.actionTurnProbe.textNotStored -and
    $overlayChatVisual.expandFocusProbe -and
    $overlayChatVisual.expandFocusProbe.overlayMode -eq "expanded" -and
    $overlayChatVisual.expandFocusProbe.inputFocused -and
    $overlayChatVisual.expandFocusProbe.quickDraftFocused -eq "true" -and
    $overlayChatVisual.expandFocusProbe.primary -eq "Draft" -and
    $overlayChatVisual.expandFocusProbe.submittedTextCount -eq 0 -and
    $overlayChatVisual.expandFocusProbe.textNotStored -and
    $overlayChatVisual.multilineInputProbe -and
    $overlayChatVisual.multilineInputProbe.control -eq "TEXTAREA" -and
    $overlayChatVisual.multilineInputProbe.rows -eq 2 -and
    $overlayChatVisual.multilineInputProbe.shiftEnterSubmittedCount -eq 0 -and
    $overlayChatVisual.multilineInputProbe.submittedCount -eq 1 -and
    $overlayChatVisual.multilineInputProbe.command -eq "mascot_overlay_draft_submitted" -and
    $overlayChatVisual.multilineInputProbe.submittedTextLineCount -eq 2 -and
    $overlayChatVisual.multilineInputProbe.overlayAction -eq "quick-draft" -and
    $overlayChatVisual.multilineInputProbe.promptKind -eq "draft" -and
    $overlayChatVisual.multilineInputProbe.inputValueLength -eq 0 -and
    $overlayChatVisual.multilineInputProbe.textNotStored -and
    $overlayChatVisual.keyboardShortcutProbe -and
    $overlayChatVisual.keyboardShortcutProbe.ctrlEnterDefaultPrevented -and
    $overlayChatVisual.keyboardShortcutProbe.submittedCount -eq 1 -and
    $overlayChatVisual.keyboardShortcutProbe.submittedTextLength -gt 0 -and
    $overlayChatVisual.keyboardShortcutProbe.submittedOverlayAction -eq "quick-draft" -and
    $overlayChatVisual.keyboardShortcutProbe.submittedPromptKind -eq "draft" -and
    $overlayChatVisual.keyboardShortcutProbe.actionAfterSend -eq "accelerator-send" -and
    $overlayChatVisual.keyboardShortcutProbe.escapeDefaultPrevented -and
    $overlayChatVisual.keyboardShortcutProbe.actionAfterEscape -eq "escape-collapse" -and
    $overlayChatVisual.keyboardShortcutProbe.overlayModeAfterEscape -eq "compact" -and
    $overlayChatVisual.keyboardShortcutProbe.collapseCommandSeen -and
    $overlayChatVisual.keyboardShortcutProbe.fillCommandCount -eq 0 -and
    $overlayChatVisual.keyboardShortcutProbe.textNotStored
  )
  overlayChatVisualRetryWorks = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.actionTurnProbe -and
    $overlayChatVisual.actionTurnProbe.retryThinking -and
    $overlayChatVisual.actionTurnProbe.retryThinking.userTurn -eq "You: Retry" -and
    $overlayChatVisual.actionTurnProbe.retryThinking.assistantTurn -eq "Smart: retrying prompt" -and
    $overlayChatVisual.actionTurnProbe.retryThinking.hint -eq "Retrying prompt" -and
    $overlayChatVisual.retryActionProbe -and
    $overlayChatVisual.retryActionProbe.actionLabel -eq "Retry" -and
    $overlayChatVisual.retryActionProbe.editedLength -gt 0 -and
    $overlayChatVisual.retryActionProbe.command -eq "mascot_overlay_clicked" -and
    $overlayChatVisual.retryActionProbe.overlayAction -eq "generate" -and
    $overlayChatVisual.retryActionProbe.promptKind -eq "generated" -and
    $overlayChatVisual.retryActionProbe.promptTextLength -eq $overlayChatVisual.retryActionProbe.editedLength -and
    $overlayChatVisual.retryActionProbe.fillCommandCount -eq 0 -and
    $overlayChatVisual.retryActionProbe.submittedTextCount -eq 0 -and
    $overlayChatVisual.retryActionProbe.textNotStored
  )
  overlayChatVisualPrivacyOk = [bool](
    $overlayChatVisual -and
    $overlayChatVisual.privacy.promptTextNotStored -and
    $overlayChatVisual.privacy.quickDraftTextNotStored -and
    $overlayChatVisual.privacy.targetInputsNotStored -and
    $overlayChatVisual.privacy.targetTitlesRedacted -and
    $overlayChatVisual.privacy.overlayUsesMetadataOnly -and
    $overlayChatVisual.privacy.conversationTurnsUseMetadataOnly
  )
  desktopDraftCdpReportPresent = [bool]($desktopDraftCdp -ne $null)
  desktopDraftCdpReady = [bool]($desktopDraftCdp -and $desktopDraftCdp.pass -and $desktopDraftCdp.draftPrepared -and $desktopDraftCdp.promptStateReady)
  desktopDraftCdpPrivacyOk = [bool](
    $desktopDraftCdp -and
    $desktopDraftCdp.privacy.draftTextNotStored -and
    $desktopDraftCdp.privacy.promptTextNotStored -and
    $desktopDraftCdp.privacy.onlyLengthAndHash -and
    $desktopDraftCdp.privacy.targetInputsNotStored
  )
}

# Phase 2 keeps these compatibility keys for report consumers, but derives them
# from the shared Assistant Card contract instead of the hidden legacy controls.
$runtimeChecks["overlayChatVisualSharedCardContractOk"] = [bool](
  $overlayChatVisual -and
  $overlayChatVisual.schemaVersion -eq "p25-overlay-chat-visual@2" -and
  $overlayChatVisual.contractVersion -eq "prompt-session@1" -and
  $overlayChatVisual.sharedCardContract.canonicalStatesCovered -and
  $overlayChatVisual.sharedCardContract.onePrimaryAction -and
  $overlayChatVisual.sharedCardContract.secondaryActionLimit -and
  $overlayChatVisual.sharedCardContract.safetyLinePresent -and
  $overlayChatVisual.sharedCardContract.legacyExpandedHidden -and
  $overlayChatVisual.sharedCardContract.noOverflow
)
$runtimeChecks["overlayChatVisualTargetMissingOk"] = [bool](
  $overlayChatVisual -and $overlayChatVisual.sharedCardContract.targetMissingAction
)
$runtimeChecks["overlayChatVisualGuardedFillOk"] = [bool](
  $overlayChatVisual -and
  $overlayChatVisual.guardedFillRouting.pass -and
  $overlayChatVisual.guardedFillRouting.command -eq "mascot_overlay_clicked" -and
  $overlayChatVisual.guardedFillRouting.overlayAction -eq "fill" -and
  $overlayChatVisual.guardedFillRouting.noAutoSubmit
)
$runtimeChecks["overlayChatVisualRegenerateOk"] = [bool](
  $overlayChatVisual -and
  $overlayChatVisual.regenerateRouting.pass -and
  $overlayChatVisual.regenerateRouting.command -eq "mascot_overlay_clicked" -and
  $overlayChatVisual.regenerateRouting.overlayAction -eq "generate" -and
  $overlayChatVisual.regenerateRouting.noAutoSubmit
)
$runtimeChecks["overlayChatVisualModeRoutingOk"] = [bool](
  $overlayChatVisual -and
  $overlayChatVisual.modeRouting.pass -and
  $overlayChatVisual.modeRouting.command -eq "mascot_overlay_clicked" -and
  $overlayChatVisual.modeRouting.overlayAction -eq "mode" -and
  $overlayChatVisual.modeRouting.promptMode -eq "polish" -and
  $overlayChatVisual.modeRouting.noAutoSubmit
)
$runtimeChecks["overlayChatVisualPrivacyOk"] = [bool](
  $overlayChatVisual -and
  $overlayChatVisual.privacy.promptTextNotStored -and
  $overlayChatVisual.privacy.targetInputsNotStored -and
  $overlayChatVisual.privacy.targetTitlesRedacted -and
  $overlayChatVisual.privacy.overlayUsesMetadataOnly -and
  $overlayChatVisual.privacy.reportStoresOnlyPromptLength
)
$runtimeChecks["overlayChatVisualCompactBackdropOk"] = [bool]($overlayChatVisual.initialCompactProbe.compactBackdropTransparent)
$runtimeChecks["overlayChatVisualCompactScreenshotOk"] = [bool]($overlayChatVisual.initialCompactProbe.compactScreenshotTransparent)
$runtimeChecks["overlayChatVisualInitialCompactOk"] = [bool](
  $overlayChatVisual.initialCompactProbe.defaultCompact -and
  $overlayChatVisual.initialCompactProbe.compactBody -and
  $overlayChatVisual.initialCompactProbe.compactCard -and
  $overlayChatVisual.initialCompactProbe.compactButton -and
  $overlayChatVisual.initialCompactProbe.compactChatHidden -and
  $overlayChatVisual.initialCompactProbe.largeWhiteBlockAbsent
)
$runtimeChecks["overlayChatVisualCompactThinkingOk"] = $runtimeChecks["overlayChatVisualInitialCompactOk"]
$runtimeChecks["overlayChatVisualWhiteBlockRegressionOk"] = $runtimeChecks["overlayChatVisualInitialCompactOk"]
$runtimeChecks["overlayChatVisualQuickRepliesWork"] = [bool](
  $runtimeChecks["overlayChatVisualSharedCardContractOk"] -and $runtimeChecks["overlayChatVisualModeRoutingOk"]
)
$runtimeChecks["overlayChatVisualRetryWorks"] = $runtimeChecks["overlayChatVisualRegenerateOk"]
$runtimeChecks["overlayChatVisualVisualAnchorMetadataOk"] = $runtimeChecks["overlayChatVisualTargetMissingOk"]

$safetyPass = [bool](
  $staticPass -and
  $runtimeChecks.overlayNoActivatePass -and
  $runtimeChecks.overlayNoActivateReportFresh -and
  $runtimeChecks.overlayVisualAttachSafetyOk -and
  $runtimeChecks.overlayVisualAttachPrivacyOk -and
  $runtimeChecks.overlayChatVisualPass -and
  $runtimeChecks.overlayChatVisualSharedCardContractOk -and
  $runtimeChecks.overlayChatVisualTargetMissingOk -and
  $runtimeChecks.overlayChatVisualGuardedFillOk -and
  $runtimeChecks.overlayChatVisualRegenerateOk -and
  $runtimeChecks.overlayChatVisualModeRoutingOk -and
  $runtimeChecks.overlayChatVisualPrivacyOk -and
  $runtimeChecks.desktopShellStartSafetyOk -and
  $runtimeChecks.desktopShellStartPrivacyOk -and
  $runtimeChecks.targetsPrivacyOk -and
  $runtimeChecks.writeGuardPrivacyOk -and
  $runtimeChecks.writeGuardDoesNotWriteWithoutTarget
)
$completionReady = [bool](
  $safetyPass -and
  $runtimeChecks.transparentReleaseCandidateReady -and
  $runtimeChecks.runtimeReadinessCompletionReady -and
  $runtimeChecks.overlayVisualAttachPass -and
  $runtimeChecks.overlayVisualAttachReportFresh -and
  $runtimeChecks.runtimeReadinessSafetyOk -and
  $runtimeChecks.runtimeReadinessScopeOk -and
  $runtimeChecks.runtimeReadinessPrivacyOk -and
  $runtimeChecks.targetsStrictForegroundReady -and
  $runtimeChecks.targetsSafeCandidatesReady -and
  $runtimeChecks.targetsWritesVerified -and
  $runtimeChecks.realOverlayClickVerified
)

$missingCompletionEvidence = @()
if (-not $runtimeChecks.overlayNoActivateReportFresh) { $missingCompletionEvidence += "fresh overlay no-activate runtime evidence" }
if (-not $runtimeChecks.overlayVisualAttachReportPresent) { $missingCompletionEvidence += "existing overlay window visual attach report" }
if (-not ($runtimeChecks.overlayVisualAttachSafetyOk -and $runtimeChecks.overlayVisualAttachPrivacyOk)) { $missingCompletionEvidence += "existing overlay window visual attach safety/privacy evidence" }
if (-not $runtimeChecks.overlayVisualAttachReportFresh) { $missingCompletionEvidence += "fresh existing overlay window visual attach evidence" }
if (-not $runtimeChecks.overlayVisualAttachPass) { $missingCompletionEvidence += "existing real overlay window geometry/no-activate/white-block evidence" }
if (-not $runtimeChecks.overlayChatVisualSharedCardContractOk) { $missingCompletionEvidence += "shared Assistant Card contract evidence" }
if (-not $runtimeChecks.overlayChatVisualTargetMissingOk) { $missingCompletionEvidence += "target-missing Assistant Card evidence" }
if (-not $runtimeChecks.overlayChatVisualGuardedFillOk) { $missingCompletionEvidence += "guarded Assistant Card fill routing evidence" }
if (-not $runtimeChecks.overlayChatVisualRegenerateOk) { $missingCompletionEvidence += "Assistant Card regenerate routing evidence" }
if (-not $runtimeChecks.overlayChatVisualModeRoutingOk) { $missingCompletionEvidence += "Assistant Card mode routing evidence" }
if (-not $runtimeChecks.desktopShellStartReportPresent) { $missingCompletionEvidence += "desktop shell start gate report" }
if (-not ($runtimeChecks.desktopShellStartSafetyOk -and $runtimeChecks.desktopShellStartPrivacyOk)) { $missingCompletionEvidence += "desktop shell start gate safety/privacy evidence" }
if (-not $runtimeChecks.transparentReleaseCandidateReady) { $missingCompletionEvidence += "fresh transparent compact release candidate artifact evidence" }
if (-not $runtimeChecks.runtimeReadinessCompletionReady) { $missingCompletionEvidence += "running desktop shell matches transparent compact release candidate" }
if (-not ($runtimeChecks.runtimeReadinessSafetyOk -and $runtimeChecks.runtimeReadinessScopeOk -and $runtimeChecks.runtimeReadinessPrivacyOk)) { $missingCompletionEvidence += "read-only runtime readiness verifier safety/privacy/scope evidence" }
if (-not $runtimeChecks.targetsStrictForegroundReady) { $missingCompletionEvidence += "strict target foreground for codex/workbuddy/trae" }
if (-not $runtimeChecks.targetsSafeCandidatesReady) { $missingCompletionEvidence += "safe composer candidate for every requested target" }
if (-not $runtimeChecks.targetsWritesVerified) { $missingCompletionEvidence += "verified real target writes" }
if (-not ($runtimeChecks.realOverlayClickDesktopPromptStateReady -or $runtimeChecks.desktopDraftCdpReady)) { $missingCompletionEvidence += "desktop shell prepared prompt metadata" }
if (-not $runtimeChecks.realOverlayClickVerified) { $missingCompletionEvidence += "real overlay click fill report" }

$reportObject = [ordered]@{
  schemaVersion = "p25-overlay-click-chain@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$safetyPass
  completionReady = [bool]$completionReady
  completionImpact = if ($completionReady) { "real_overlay_click_fill_verified" } elseif (-not $runtimeChecks.runtimeReadinessCompletionReady) { "runtime_readiness_missing" } elseif (-not $runtimeChecks.overlayVisualAttachPass) { "overlay_window_visual_attach_missing" } elseif (-not $runtimeChecks.realOverlayClickVerified) { "real_overlay_click_fill_missing" } else { "target_evidence_incomplete" }
  staticChecks = $staticChecks
  runtimeChecks = $runtimeChecks
  runtimeEvidence = [ordered]@{
    runtimeReadinessReport = if ($runtimeReadiness -ne $null) { ConvertTo-RepoRelativePath (Resolve-RepoPath $RuntimeReadinessReport) } else { $null }
    runtimeReadinessReportLastWriteUtc = if ($runtimeReadinessReportTime) { $runtimeReadinessReportTime.ToString("o") } else { $null }
    runtimeReadinessPass = [bool]($runtimeReadinessSummary.pass)
    runtimeReadinessCompletionReady = [bool]($runtimeReadinessSummary.completionReady)
    runtimeReadinessCandidateFound = [bool]($runtimeReadinessSummary.candidateFound)
    runtimeReadinessCandidateRecent = [bool]($runtimeReadinessSummary.candidateRecent)
    runtimeReadinessCandidateFresh = [bool]($runtimeReadinessSummary.candidateFresh)
    runtimeReadinessCandidateReady = [bool]($runtimeReadinessSummary.candidateReady)
    runtimeReadinessProcessCount = [int]($runtimeReadinessSummary.processCount)
    runtimeReadinessMatchingProcessCount = [int]($runtimeReadinessSummary.matchingProcessCount)
    runtimeReadinessUnknownPathProcessCount = [int]($runtimeReadinessSummary.unknownPathProcessCount)
    runtimeReadinessOverlayWindowCount = [int]($runtimeReadinessSummary.overlayWindowCount)
    runtimeReadinessOverlayMatchesDesktopShellProcess = [bool]($runtimeReadinessSummary.overlayMatchesDesktopShellProcess)
    runtimeReadinessSafetyOk = [bool]($runtimeReadinessSummary.safetyOk)
    runtimeReadinessScopeOk = [bool]($runtimeReadinessSummary.scopeOk)
    runtimeReadinessPrivacyOk = [bool]($runtimeReadinessSummary.privacyOk)
    runtimeReadinessSidecarProcessCount = [int]($runtimeReadinessSummary.sidecarProcessCount)
    desktopShellStartReport = if ($desktopShellStart -ne $null) { ConvertTo-RepoRelativePath (Resolve-RepoPath $DesktopShellStartReport) } else { $null }
    desktopShellStartReportLastWriteUtc = if ($desktopShellStartReportTime) { $desktopShellStartReportTime.ToString("o") } else { $null }
    desktopShellStartCompletionReady = [bool]($runtimeChecks.desktopShellStartCompletionReady)
    desktopShellStartStatus = if ($desktopShellStart) { [string]$desktopShellStart.status } else { "" }
    desktopShellStartAllowed = [bool]($desktopShellStart -and $desktopShellStart.safety.startAllowed)
    desktopShellStartAttempted = [bool]($desktopShellStart -and $desktopShellStart.safety.startAttempted)
    desktopShellStartSafetyOk = [bool]($runtimeChecks.desktopShellStartSafetyOk)
    desktopShellStartPrivacyOk = [bool]($runtimeChecks.desktopShellStartPrivacyOk)
    desktopShellStartBeforeCount = if ($desktopShellStart -and $desktopShellStart.process) { [int]$desktopShellStart.process.beforeCount } else { 0 }
    desktopShellStartAfterCount = if ($desktopShellStart -and $desktopShellStart.process) { [int]$desktopShellStart.process.afterCount } else { 0 }
    desktopShellStartExistingProcessBlocksStart = [bool]($runtimeChecks.desktopShellStartExistingProcessBlocksStart)
    desktopShellStartSafeToStartWithoutStoppingExisting = [bool]($runtimeChecks.desktopShellStartSafeToStartWithoutStoppingExisting)
    desktopShellStartNextAction = if ($desktopShellStart -and $desktopShellStart.diagnostics) { [string]$desktopShellStart.diagnostics.nextAction } else { "" }
    overlayNoActivateReportLastWriteUtc = if ($overlayNoActivateReportTime) { $overlayNoActivateReportTime.ToString("o") } else { $null }
    overlayVisualAttachReport = if ($overlayVisualAttach -ne $null) { ConvertTo-RepoRelativePath (Resolve-RepoPath $OverlayVisualAttachReport) } else { $null }
    overlayVisualAttachReportLastWriteUtc = if ($overlayVisualAttachReportTime) { $overlayVisualAttachReportTime.ToString("o") } else { $null }
    overlayVisualAttachCompletionImpact = [string]$overlayVisualAttachSummary.completionImpact
    overlayVisualAttachWindowFound = [bool]$overlayVisualAttachSummary.windowFound
    overlayVisualAttachWindowCount = [int]$overlayVisualAttachSummary.windowCount
    overlayVisualAttachNoActivateStyle = [bool]$overlayVisualAttachSummary.noActivateStyle
    overlayVisualAttachGeometryOk = [bool]$overlayVisualAttachSummary.geometryMatchesExpectedOverlaySize
    overlayVisualAttachLargeWhiteBlockAbsent = [bool]$overlayVisualAttachSummary.largeWhiteBlockAbsent
    overlayVisualAttachScreenshotSaved = [bool]$overlayVisualAttachSummary.screenshotSaved
    overlayVisualAttachSafetyOk = [bool]$overlayVisualAttachSummary.safetyOk
    overlayVisualAttachPrivacyOk = [bool]$overlayVisualAttachSummary.privacyOk
    overlayRuntimeSourceLastWriteUtc = if ($overlayRuntimeSourceTime) { $overlayRuntimeSourceTime.ToString("o") } else { $null }
    transparentReleaseExe = [string]$TransparentReleaseExe
    transparentReleaseExePresent = [bool]$transparentReleaseExePresent
    transparentReleaseExeLastWriteUtc = if ($transparentReleaseExeTime) { $transparentReleaseExeTime.ToString("o") } else { $null }
    transparentReleaseExeSizeBytes = if ($transparentReleaseExeSize -ne $null) { [long]$transparentReleaseExeSize } else { $null }
    transparentReleaseExeSha256Prefix = if ($transparentReleaseExeSha256) { [string]$transparentReleaseExeSha256 } else { $null }
    transparentReleaseDistLastWriteUtc = if ($desktopDistInputTime) { $desktopDistInputTime.ToString("o") } else { $null }
    transparentReleaseSourceLastWriteUtc = if ($transparentReleaseSourceTime) { $transparentReleaseSourceTime.ToString("o") } else { $null }
    transparentReleaseExeMatchesNoActivateReport = [bool]$transparentReleaseExeReportMatch
  }
  targetSummary = $targetSummary
  writeGuardSummary = $writeGuardSummary
  composerDiagnosticsSummary = if ($composerDiagnostics -and $composerDiagnostics.summary) { $composerDiagnostics.summary } else { $null }
  desktopDraftCdpSummary = if ($desktopDraftCdp) {
    [pscustomobject]@{
      pass = [bool]$desktopDraftCdp.pass
      draftPrepared = [bool]$desktopDraftCdp.draftPrepared
      promptStateReady = [bool]$desktopDraftCdp.promptStateReady
      activeTextKind = if ($desktopDraftCdp.promptState) { [string]$desktopDraftCdp.promptState.activeTextKind } else { "" }
      activeTextLength = if ($desktopDraftCdp.promptState) { [int]$desktopDraftCdp.promptState.activeTextLength } else { 0 }
    }
  } else {
    $null
  }
  overlayVisualAttachSummary = if ($overlayVisualAttach) {
    [ordered]@{
      pass = [bool]$overlayVisualAttachSummary.pass
      completionImpact = [string]$overlayVisualAttachSummary.completionImpact
      windowFound = [bool]$overlayVisualAttachSummary.windowFound
      windowCount = [int]$overlayVisualAttachSummary.windowCount
      windowVisible = [bool]$overlayVisualAttachSummary.windowVisible
      noActivateStyle = [bool]$overlayVisualAttachSummary.noActivateStyle
      geometryMatchesExpectedOverlaySize = [bool]$overlayVisualAttachSummary.geometryMatchesExpectedOverlaySize
      largeWhiteBlockAbsent = [bool]$overlayVisualAttachSummary.largeWhiteBlockAbsent
      screenshotSaved = [bool]$overlayVisualAttachSummary.screenshotSaved
      safetyOk = [bool]$overlayVisualAttachSummary.safetyOk
      privacyOk = [bool]$overlayVisualAttachSummary.privacyOk
    }
  } else {
    $null
  }
  overlayChatVisualSummary = if ($overlayChatVisual) {
    [ordered]@{
      pass = [bool]$overlayChatVisual.pass
      browserExecutable = [string]$overlayChatVisual.browserExecutable
      viewports = $overlayChatVisual.overlayViewports
      stateCount = @($overlayChatVisual.checks).Count
      initialCompactProbe = if ($overlayChatVisual.initialCompactProbe) {
        [ordered]@{
          screenshot = [string]$overlayChatVisual.initialCompactProbe.screenshot
          defaultCompact = [bool]$overlayChatVisual.initialCompactProbe.defaultCompact
          compactBody = [bool]$overlayChatVisual.initialCompactProbe.compactBody
          compactCard = [bool]$overlayChatVisual.initialCompactProbe.compactCard
          compactButton = [bool]$overlayChatVisual.initialCompactProbe.compactButton
          compactBadgeDot = [bool]$overlayChatVisual.initialCompactProbe.compactBadgeDot
          compactChatHidden = [bool]$overlayChatVisual.initialCompactProbe.compactChatHidden
          compactBackdropTransparent = [bool]$overlayChatVisual.initialCompactProbe.compactBackdropTransparent
          largeWhiteBlockAbsent = [bool]$overlayChatVisual.initialCompactProbe.largeWhiteBlockAbsent
          screenshotTransparency = $overlayChatVisual.initialCompactProbe.screenshotTransparency
        }
      } else {
        $null
      }
      compactThinkingProbe = if ($overlayChatVisual.compactThinkingProbe) {
        [ordered]@{
          screenshot = [string]$overlayChatVisual.compactThinkingProbe.screenshot
          state = [string]$overlayChatVisual.compactThinkingProbe.state
          defaultCompact = [bool]$overlayChatVisual.compactThinkingProbe.defaultCompact
          compactBody = [bool]$overlayChatVisual.compactThinkingProbe.compactBody
          compactCard = [bool]$overlayChatVisual.compactThinkingProbe.compactCard
          compactButton = [bool]$overlayChatVisual.compactThinkingProbe.compactButton
          compactBadgeDot = [bool]$overlayChatVisual.compactThinkingProbe.compactBadgeDot
          compactChatHidden = [bool]$overlayChatVisual.compactThinkingProbe.compactChatHidden
          compactBackdropTransparent = [bool]$overlayChatVisual.compactThinkingProbe.compactBackdropTransparent
          largeWhiteBlockAbsent = [bool]$overlayChatVisual.compactThinkingProbe.largeWhiteBlockAbsent
          screenshotTransparency = $overlayChatVisual.compactThinkingProbe.screenshotTransparency
        }
      } else {
        $null
      }
      whiteBlockRegressionProbe = if ($overlayChatVisual.whiteBlockRegressionProbe) {
        [ordered]@{
          screenshot = [string]$overlayChatVisual.whiteBlockRegressionProbe.screenshot
          viewport = $overlayChatVisual.whiteBlockRegressionProbe.viewport
          state = [string]$overlayChatVisual.whiteBlockRegressionProbe.state
          defaultCompact = [bool]$overlayChatVisual.whiteBlockRegressionProbe.defaultCompact
          compactBody = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactBody
          compactCard = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactCard
          compactButton = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactButton
          compactBadgeDot = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactBadgeDot
          compactChatHidden = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactChatHidden
          compactBackdropTransparent = [bool]$overlayChatVisual.whiteBlockRegressionProbe.compactBackdropTransparent
          largeWhiteBlockAbsent = [bool]$overlayChatVisual.whiteBlockRegressionProbe.largeWhiteBlockAbsent
          screenshotTransparency = $overlayChatVisual.whiteBlockRegressionProbe.screenshotTransparency
        }
      } else {
        $null
      }
      compactBackdrop = @($overlayChatVisual.checks | Where-Object { $_.overlayMode -eq "compact" } | ForEach-Object {
        [ordered]@{
          name = [string]$_.name
          compactBackdropTransparent = [bool]$_.compactBackdropTransparent
          compactScreenshotTransparent = [bool]$_.compactScreenshotTransparent
          backdrop = $_.backdrop
          screenshotTransparency = $_.screenshotTransparency
        }
      })
      visualOnlyAnchorProbe = if ($overlayChatVisual.checks) {
        $visualAnchorProbe = @($overlayChatVisual.checks | Where-Object { $_.name -eq "visual-only-no-safe-candidate" } | Select-Object -First 1)
        if ($visualAnchorProbe.Count -gt 0) {
          [ordered]@{
            browserLikeComposerCandidateCount = [string]$visualAnchorProbe[0].browserLikeComposerCandidateCount
            visualAnchorIndex = [string]$visualAnchorProbe[0].visualAnchorIndex
            visualAnchorReason = [string]$visualAnchorProbe[0].visualAnchorReason
            hint = [string]$visualAnchorProbe[0].hint
            noAutoSubmit = [bool]$visualAnchorProbe[0].noAutoSubmit
            visualOnlyMatches = [bool]$visualAnchorProbe[0].visualOnlyMatches
            browserLikeComposerCandidateCountMatches = [bool]$visualAnchorProbe[0].browserLikeComposerCandidateCountMatches
            visualAnchorIndexMatches = [bool]$visualAnchorProbe[0].visualAnchorIndexMatches
            visualAnchorReasonMatches = [bool]$visualAnchorProbe[0].visualAnchorReasonMatches
          }
        } else {
          $null
        }
      } else {
        $null
      }
      quickReplyProbe = if ($overlayChatVisual.quickReplyProbe) {
        [ordered]@{
          quickDraftValueLength = [int]$overlayChatVisual.quickReplyProbe.quickDraftValueLength
          quickReplySelected = [string]$overlayChatVisual.quickReplyProbe.quickReplySelected
          message = [string]$overlayChatVisual.quickReplyProbe.message
          hint = [string]$overlayChatVisual.quickReplyProbe.hint
          badge = [string]$overlayChatVisual.quickReplyProbe.badge
          primary = [string]$overlayChatVisual.quickReplyProbe.primary
          primaryAction = [string]$overlayChatVisual.quickReplyProbe.primaryAction
          userTurn = [string]$overlayChatVisual.quickReplyProbe.userTurn
          assistantTurn = [string]$overlayChatVisual.quickReplyProbe.assistantTurn
          quickReplySelectedLabel = [string]$overlayChatVisual.quickReplyProbe.quickReplySelectedLabel
          textNotStored = [bool]$overlayChatVisual.quickReplyProbe.textNotStored
        }
      } else {
        $null
      }
      sendButtonProbe = if ($overlayChatVisual.sendButtonProbe) {
        [ordered]@{
          sendGlyph = [string]$overlayChatVisual.sendButtonProbe.sendGlyph
          emptyDisabled = [bool]$overlayChatVisual.sendButtonProbe.emptyDisabled
          emptyReady = [string]$overlayChatVisual.sendButtonProbe.emptyReady
          emptySubmittedCount = [int]$overlayChatVisual.sendButtonProbe.emptySubmittedCount
          filledDisabled = [bool]$overlayChatVisual.sendButtonProbe.filledDisabled
          filledReady = [string]$overlayChatVisual.sendButtonProbe.filledReady
          submittedCount = [int]$overlayChatVisual.sendButtonProbe.submittedCount
          command = [string]$overlayChatVisual.sendButtonProbe.command
          submittedTextLength = [int]$overlayChatVisual.sendButtonProbe.submittedTextLength
          overlayAction = [string]$overlayChatVisual.sendButtonProbe.overlayAction
          promptKind = [string]$overlayChatVisual.sendButtonProbe.promptKind
          promptReady = [bool]$overlayChatVisual.sendButtonProbe.promptReady
          inputValueLength = [int]$overlayChatVisual.sendButtonProbe.inputValueLength
          textNotStored = [bool]$overlayChatVisual.sendButtonProbe.textNotStored
        }
      } else {
        $null
      }
      pendingActionProbe = if ($overlayChatVisual.pendingActionProbe) {
        [ordered]@{
          quickDraftPending = [string]$overlayChatVisual.pendingActionProbe.quickDraftPending
          primary = [string]$overlayChatVisual.pendingActionProbe.primary
          primaryAction = [string]$overlayChatVisual.pendingActionProbe.primaryAction
          disabledActions = @($overlayChatVisual.pendingActionProbe.disabledActions)
          disabledModes = @($overlayChatVisual.pendingActionProbe.disabledModes)
          disabledReplies = @($overlayChatVisual.pendingActionProbe.disabledReplies)
          valueStableAfterLockedReplies = [bool]$overlayChatVisual.pendingActionProbe.valueStableAfterLockedReplies
          invokedCount = [int]$overlayChatVisual.pendingActionProbe.invokedCount
          submittedTextCount = [int]$overlayChatVisual.pendingActionProbe.submittedTextCount
          fillCommandCount = [int]$overlayChatVisual.pendingActionProbe.fillCommandCount
          textNotStored = [bool]$overlayChatVisual.pendingActionProbe.textNotStored
        }
      } else {
        $null
      }
      modeReplyProbe = if ($overlayChatVisual.modeReplyProbe) {
        [ordered]@{
          promptMode = [string]$overlayChatVisual.modeReplyProbe.promptMode
          replyActions = @($overlayChatVisual.modeReplyProbe.replyActions)
          primary = [string]$overlayChatVisual.modeReplyProbe.primary
          userTurn = [string]$overlayChatVisual.modeReplyProbe.userTurn
          assistantTurn = [string]$overlayChatVisual.modeReplyProbe.assistantTurn
          command = [string]$overlayChatVisual.modeReplyProbe.command
          overlayAction = [string]$overlayChatVisual.modeReplyProbe.overlayAction
          invokedPromptMode = [string]$overlayChatVisual.modeReplyProbe.invokedPromptMode
          submittedTextCount = [int]$overlayChatVisual.modeReplyProbe.submittedTextCount
          textNotStored = [bool]$overlayChatVisual.modeReplyProbe.textNotStored
        }
      } else {
        $null
      }
      contextualReplyProbe = if ($overlayChatVisual.contextualReplyProbe) {
        [ordered]@{
          quickDraftValueLength = [int]$overlayChatVisual.contextualReplyProbe.quickDraftValueLength
          quickReplySelected = [string]$overlayChatVisual.contextualReplyProbe.quickReplySelected
          message = [string]$overlayChatVisual.contextualReplyProbe.message
          hint = [string]$overlayChatVisual.contextualReplyProbe.hint
          badge = [string]$overlayChatVisual.contextualReplyProbe.badge
          primary = [string]$overlayChatVisual.contextualReplyProbe.primary
          primaryAction = [string]$overlayChatVisual.contextualReplyProbe.primaryAction
          userTurn = [string]$overlayChatVisual.contextualReplyProbe.userTurn
          assistantTurn = [string]$overlayChatVisual.contextualReplyProbe.assistantTurn
          quickReplySelectedLabel = [string]$overlayChatVisual.contextualReplyProbe.quickReplySelectedLabel
          textNotStored = [bool]$overlayChatVisual.contextualReplyProbe.textNotStored
        }
      } else {
        $null
      }
      primarySendProbe = if ($overlayChatVisual.primarySendProbe) {
        [ordered]@{
          submittedCount = [int]$overlayChatVisual.primarySendProbe.submittedCount
          command = [string]$overlayChatVisual.primarySendProbe.command
          submittedTextLength = [int]$overlayChatVisual.primarySendProbe.submittedTextLength
          overlayAction = [string]$overlayChatVisual.primarySendProbe.overlayAction
          promptKind = [string]$overlayChatVisual.primarySendProbe.promptKind
          promptReady = [bool]$overlayChatVisual.primarySendProbe.promptReady
          inputValueLength = [int]$overlayChatVisual.primarySendProbe.inputValueLength
          userTurn = [string]$overlayChatVisual.primarySendProbe.userTurn
          assistantTurn = [string]$overlayChatVisual.primarySendProbe.assistantTurn
          textNotStored = [bool]$overlayChatVisual.primarySendProbe.textNotStored
        }
      } else {
        $null
      }
      actionTurnProbe = if ($overlayChatVisual.actionTurnProbe) {
        [ordered]@{
          draft = $overlayChatVisual.actionTurnProbe.draft
          scan = $overlayChatVisual.actionTurnProbe.scan
          fill = $overlayChatVisual.actionTurnProbe.fill
          retryThinking = $overlayChatVisual.actionTurnProbe.retryThinking
          invokedCount = [int]$overlayChatVisual.actionTurnProbe.invokedCount
          submittedTextCount = [int]$overlayChatVisual.actionTurnProbe.submittedTextCount
          textNotStored = [bool]$overlayChatVisual.actionTurnProbe.textNotStored
        }
      } else {
        $null
      }
      expandFocusProbe = if ($overlayChatVisual.expandFocusProbe) {
        [ordered]@{
          overlayMode = [string]$overlayChatVisual.expandFocusProbe.overlayMode
          inputFocused = [bool]$overlayChatVisual.expandFocusProbe.inputFocused
          quickDraftFocused = [string]$overlayChatVisual.expandFocusProbe.quickDraftFocused
          primary = [string]$overlayChatVisual.expandFocusProbe.primary
          submittedTextCount = [int]$overlayChatVisual.expandFocusProbe.submittedTextCount
          textNotStored = [bool]$overlayChatVisual.expandFocusProbe.textNotStored
        }
      } else {
        $null
      }
      multilineInputProbe = if ($overlayChatVisual.multilineInputProbe) {
        [ordered]@{
          control = [string]$overlayChatVisual.multilineInputProbe.control
          rows = [int]$overlayChatVisual.multilineInputProbe.rows
          shiftEnterSubmittedCount = [int]$overlayChatVisual.multilineInputProbe.shiftEnterSubmittedCount
          submittedCount = [int]$overlayChatVisual.multilineInputProbe.submittedCount
          command = [string]$overlayChatVisual.multilineInputProbe.command
          submittedTextLength = [int]$overlayChatVisual.multilineInputProbe.submittedTextLength
          submittedTextLineCount = [int]$overlayChatVisual.multilineInputProbe.submittedTextLineCount
          overlayAction = [string]$overlayChatVisual.multilineInputProbe.overlayAction
          promptKind = [string]$overlayChatVisual.multilineInputProbe.promptKind
          inputValueLength = [int]$overlayChatVisual.multilineInputProbe.inputValueLength
          textNotStored = [bool]$overlayChatVisual.multilineInputProbe.textNotStored
        }
      } else {
        $null
      }
      keyboardShortcutProbe = if ($overlayChatVisual.keyboardShortcutProbe) {
        [ordered]@{
          ctrlEnterDefaultPrevented = [bool]$overlayChatVisual.keyboardShortcutProbe.ctrlEnterDefaultPrevented
          submittedCount = [int]$overlayChatVisual.keyboardShortcutProbe.submittedCount
          submittedTextLength = [int]$overlayChatVisual.keyboardShortcutProbe.submittedTextLength
          submittedOverlayAction = [string]$overlayChatVisual.keyboardShortcutProbe.submittedOverlayAction
          submittedPromptKind = [string]$overlayChatVisual.keyboardShortcutProbe.submittedPromptKind
          actionAfterSend = [string]$overlayChatVisual.keyboardShortcutProbe.actionAfterSend
          escapeDefaultPrevented = [bool]$overlayChatVisual.keyboardShortcutProbe.escapeDefaultPrevented
          actionAfterEscape = [string]$overlayChatVisual.keyboardShortcutProbe.actionAfterEscape
          overlayModeAfterEscape = [string]$overlayChatVisual.keyboardShortcutProbe.overlayModeAfterEscape
          collapseCommandSeen = [bool]$overlayChatVisual.keyboardShortcutProbe.collapseCommandSeen
          fillCommandCount = [int]$overlayChatVisual.keyboardShortcutProbe.fillCommandCount
          textNotStored = [bool]$overlayChatVisual.keyboardShortcutProbe.textNotStored
        }
      } else {
        $null
      }
      retryActionProbe = if ($overlayChatVisual.retryActionProbe) {
        [ordered]@{
          actionLabel = [string]$overlayChatVisual.retryActionProbe.actionLabel
          editedLength = [int]$overlayChatVisual.retryActionProbe.editedLength
          command = [string]$overlayChatVisual.retryActionProbe.command
          overlayAction = [string]$overlayChatVisual.retryActionProbe.overlayAction
          promptKind = [string]$overlayChatVisual.retryActionProbe.promptKind
          promptTextLength = [int]$overlayChatVisual.retryActionProbe.promptTextLength
          fillCommandCount = [int]$overlayChatVisual.retryActionProbe.fillCommandCount
          submittedTextCount = [int]$overlayChatVisual.retryActionProbe.submittedTextCount
          textNotStored = [bool]$overlayChatVisual.retryActionProbe.textNotStored
        }
      } else {
        $null
      }
      screenshots = @($overlayChatVisual.checks | ForEach-Object { $_.screenshot })
    }
  } else {
    $null
  }
  missingCompletionEvidence = $missingCompletionEvidence
  privacy = [ordered]@{
    targetTitlesRedacted = $true
    targetInputsNotStored = $true
    promptTextNotStored = $true
    quickDraftTextNotStored = $true
    rawDesktopPixelsPersisted = [bool]($overlayVisualAttach -and $overlayVisualAttach.privacy.rawDesktopPixelsPersisted)
    overlayVisualAttachOnlyMetadataStored = [bool]($overlayVisualAttachSummary.privacyOk)
    noAutoSubmitRequired = $true
    overlayPayloadRequired = $true
  }
}

$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}
$reportObject | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $reportPath
Write-Host "P25 overlay click chain report: $reportPath"
Write-Host ($reportObject | ConvertTo-Json -Depth 12)

if (-not $reportObject.pass) {
  exit 1
}
