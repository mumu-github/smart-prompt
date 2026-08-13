param(
  [ValidateSet("DesktopShellVisualRuntime", "MascotOverlayNoActivate", "OverlayWindowVisualAttach")]
  [string]$Mode = "DesktopShellVisualRuntime",
  [string]$Report = "",
  [string]$ExePath = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$StartReport = "research/p25-desktop-shell-start.latest.json",
  [string]$RuntimeReadinessReport = "research/p25-runtime-readiness.latest.json",
  [string]$OverlayNoActivateReport = "research/p25-mascot-overlay-noactivate.latest.json",
  [string]$OverlayVisualAttachReport = "research/p25-overlay-window-visual-attach.latest.json",
  [string]$OverlayVisualScreenshot = "research/p25-overlay-window-visual-attach.png",
  [string]$OverlayClickChainReport = "research/p25-overlay-click-chain.latest.json",
  [string]$Screenshot = "research/p25-overlay-window-visual-attach.png",
  [int]$TimeoutSeconds = 20,
  [switch]$AttachOnly,
  [switch]$KeepRunning,
  [switch]$AllowScreenshot,
  [switch]$AllowStartDesktopShell,
  [switch]$AllowVisualScreenshot,
  [switch]$AllowFailure
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ImplDir = Join-Path $ScriptDir "p25-visual"

function Invoke-VisualImpl {
  param(
    [string]$ImplName,
    [string[]]$Arguments
  )
  $implPath = Join-Path $ImplDir $ImplName
  if (-not (Test-Path -LiteralPath $implPath)) {
    throw "Missing P25 visual implementation: $implPath"
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $implPath @Arguments
  exit $LASTEXITCODE
}

switch ($Mode) {
  "MascotOverlayNoActivate" {
    $targetReport = if ([string]::IsNullOrWhiteSpace($Report)) { "research/p25-mascot-overlay-noactivate.latest.json" } else { $Report }
    $arguments = @(
      "-Report", $targetReport,
      "-ExePath", $ExePath,
      "-TimeoutSeconds", ([string]$TimeoutSeconds)
    )
    if ($AttachOnly) { $arguments += "-AttachOnly" }
    if ($KeepRunning) { $arguments += "-KeepRunning" }
    if ($AllowFailure) { $arguments += "-AllowFailure" }
    Invoke-VisualImpl -ImplName "mascot-overlay-noactivate.impl.ps1" -Arguments $arguments
  }
  "OverlayWindowVisualAttach" {
    $targetReport = if ([string]::IsNullOrWhiteSpace($Report)) { "research/p25-overlay-window-visual-attach.latest.json" } else { $Report }
    $arguments = @(
      "-Report", $targetReport,
      "-Screenshot", $Screenshot,
      "-TimeoutSeconds", ([string]$TimeoutSeconds)
    )
    if ($AllowScreenshot) { $arguments += "-AllowScreenshot" }
    if ($AllowFailure) { $arguments += "-AllowFailure" }
    Invoke-VisualImpl -ImplName "overlay-window-visual-attach.impl.ps1" -Arguments $arguments
  }
  default {
    $targetReport = if ([string]::IsNullOrWhiteSpace($Report)) { "research/p25-desktop-shell-visual-runtime.latest.json" } else { $Report }
    $arguments = @(
      "-Report", $targetReport,
      "-TransparentReleaseExe", $TransparentReleaseExe,
      "-StartReport", $StartReport,
      "-RuntimeReadinessReport", $RuntimeReadinessReport,
      "-OverlayNoActivateReport", $OverlayNoActivateReport,
      "-OverlayVisualAttachReport", $OverlayVisualAttachReport,
      "-OverlayVisualScreenshot", $OverlayVisualScreenshot,
      "-OverlayClickChainReport", $OverlayClickChainReport,
      "-TimeoutSeconds", ([string]$TimeoutSeconds)
    )
    if ($AllowStartDesktopShell) { $arguments += "-AllowStartDesktopShell" }
    if ($AllowVisualScreenshot) { $arguments += "-AllowVisualScreenshot" }
    if ($AllowFailure) { $arguments += "-AllowFailure" }
    Invoke-VisualImpl -ImplName "desktop-shell-visual-runtime.impl.ps1" -Arguments $arguments
  }
}
