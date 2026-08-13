param(
  [string]$Report = "research/p25-overlay-window-visual-attach.latest.json",
  [string]$Screenshot = "research/p25-overlay-window-visual-attach.png",
  [int]$TimeoutSeconds = 3,
  [switch]$AllowScreenshot,
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
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull = "$rootFull$([System.IO.Path]::DirectorySeparatorChar)"
  }
  if ($full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($rootFull.Length).Replace("\", "/")
  }
  return $full.Replace("\", "/")
}

function Get-TextHash {
  param([string]$TextValue)
  if ($null -eq $TextValue) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($TextValue)
    $hashBytes = $sha.ComputeHash($bytes)
    return ([BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()).Substring(0, 16)
  } finally {
    $sha.Dispose()
  }
}

$nativeDefinition = @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

public delegate bool SmartPromptOverlayVisualEnumProc(IntPtr hWnd, IntPtr lParam);

[StructLayout(LayoutKind.Sequential)]
public struct SmartPromptOverlayVisualRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public sealed class SmartPromptOverlayVisualWindowInfo {
  public IntPtr Handle;
  public int ProcessId;
  public string Title;
  public long ExStyle;
  public bool Visible;
  public SmartPromptOverlayVisualRect Rect;
}

public static class SmartPromptOverlayVisualNative {
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const long WS_EX_TOOLWINDOW = 0x00000080L;
  public const long WS_EX_NOACTIVATE = 0x08000000L;

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(SmartPromptOverlayVisualEnumProc enumProc, IntPtr lParam);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextLengthW(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)]
  public static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptOverlayVisualRect rect);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
  }

  public static SmartPromptOverlayVisualWindowInfo[] FindMascotWindows() {
    List<SmartPromptOverlayVisualWindowInfo> windows = new List<SmartPromptOverlayVisualWindowInfo>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      string title = GetTitle(hWnd);
      if (title == "Smart Prompt Mascot") {
        uint processId;
        SmartPromptOverlayVisualRect rect;
        GetWindowThreadProcessId(hWnd, out processId);
        GetWindowRect(hWnd, out rect);
        windows.Add(new SmartPromptOverlayVisualWindowInfo {
          Handle = hWnd,
          ProcessId = (int)processId,
          Title = title,
          ExStyle = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64(),
          Visible = IsWindowVisible(hWnd),
          Rect = rect
        });
      }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  private static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLengthW(hWnd);
    if (length <= 0) {
      return "";
    }
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowTextW(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }
}
"@

if (-not ("SmartPromptOverlayVisualNative" -as [type])) {
  Add-Type -TypeDefinition $nativeDefinition
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Get-OverlayWindowMetadata {
  param($Window)

  $width = [Math]::Max(0, [int]($Window.Rect.Right - $Window.Rect.Left))
  $height = [Math]::Max(0, [int]($Window.Rect.Bottom - $Window.Rect.Top))
  $title = if ($null -ne $Window.Title) { [string]$Window.Title } else { "" }
  $noActivate = (($Window.ExStyle -band [SmartPromptOverlayVisualNative]::WS_EX_NOACTIVATE) -ne 0)
  $topmost = (($Window.ExStyle -band [SmartPromptOverlayVisualNative]::WS_EX_TOPMOST) -ne 0)
  $toolWindow = (($Window.ExStyle -band [SmartPromptOverlayVisualNative]::WS_EX_TOOLWINDOW) -ne 0)
  $looksCompact = ($width -ge 60 -and $width -le 96 -and $height -ge 60 -and $height -le 96)
  $looksExpanded = ($width -ge 300 -and $width -le 380 -and $height -ge 330 -and $height -le 420)

  return [ordered]@{
    hwnd = ("0x{0:x}" -f $Window.Handle.ToInt64())
    processId = [int]$Window.ProcessId
    titleHash = Get-TextHash $title
    titleLength = [int]$title.Length
    visible = [bool]$Window.Visible
    exStyleHex = ("0x{0:x}" -f $Window.ExStyle)
    noActivate = [bool]$noActivate
    topmost = [bool]$topmost
    toolWindow = [bool]$toolWindow
    rect = [ordered]@{
      left = [int]$Window.Rect.Left
      top = [int]$Window.Rect.Top
      right = [int]$Window.Rect.Right
      bottom = [int]$Window.Rect.Bottom
      width = [int]$width
      height = [int]$height
    }
    geometry = [ordered]@{
      looksCompact = [bool]$looksCompact
      looksExpanded = [bool]$looksExpanded
      matchesExpectedOverlaySize = [bool]($looksCompact -or $looksExpanded)
    }
  }
}

function Test-OverlayWindowVisuallyReady {
  param([object[]]$Windows)

  foreach ($window in @($Windows)) {
    $metadata = Get-OverlayWindowMetadata -Window $window
    if ($metadata.visible -and $metadata.geometry.matchesExpectedOverlaySize) {
      return $true
    }
  }
  return $false
}

function Measure-BitmapPixels {
  param([System.Drawing.Bitmap]$Bitmap)

  $area = [Math]::Max(1, [int]($Bitmap.Width * $Bitmap.Height))
  $maxSamples = 12000
  $step = [Math]::Max(1, [int][Math]::Floor([Math]::Sqrt($area / $maxSamples)))
  $sampleCount = 0
  $nearWhiteCount = 0
  $nearBlackCount = 0
  $saturatedCount = 0

  for ($y = 0; $y -lt $Bitmap.Height; $y += $step) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $step) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $sampleCount += 1
      if ($pixel.R -ge 245 -and $pixel.G -ge 245 -and $pixel.B -ge 245) {
        $nearWhiteCount += 1
      }
      if ($pixel.R -le 16 -and $pixel.G -le 16 -and $pixel.B -le 16) {
        $nearBlackCount += 1
      }
      if ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) -ge 245) {
        $saturatedCount += 1
      }
    }
  }

  if ($sampleCount -le 0) {
    $sampleCount = 1
  }

  return [ordered]@{
    sampleCount = [int]$sampleCount
    samplingStep = [int]$step
    nearWhiteRatio = [double][Math]::Round($nearWhiteCount / $sampleCount, 4)
    nearBlackRatio = [double][Math]::Round($nearBlackCount / $sampleCount, 4)
    saturatedRatio = [double][Math]::Round($saturatedCount / $sampleCount, 4)
  }
}

function Get-OverlayScreenEvidence {
  param(
    $Window,
    [string]$ScreenshotPath,
    [bool]$SaveScreenshot
  )

  $windowWidth = [Math]::Max(0, [int]($Window.Rect.Right - $Window.Rect.Left))
  $windowHeight = [Math]::Max(0, [int]($Window.Rect.Bottom - $Window.Rect.Top))
  $evidence = [ordered]@{
    captured = $false
    captureError = ""
    alphaUnavailableFromScreenCapture = $true
    screenshotSaved = $false
    screenshotPath = ""
    windowWidth = [int]$windowWidth
    windowHeight = [int]$windowHeight
    captureWidth = 0
    captureHeight = 0
    captureClippedToVirtualScreen = $false
    pixelStats = [ordered]@{
      sampleCount = 0
      samplingStep = 0
      nearWhiteRatio = 0.0
      nearBlackRatio = 0.0
      saturatedRatio = 0.0
    }
    largeWhiteBlockAbsent = $false
    oldWhiteBlockLike = $false
  }

  if ($windowWidth -le 0 -or $windowHeight -le 0) {
    $evidence.captureError = "window_rect_empty"
    return $evidence
  }

  $bitmap = $null
  $graphics = $null
  try {
    $windowRect = [System.Drawing.Rectangle]::new($Window.Rect.Left, $Window.Rect.Top, $windowWidth, $windowHeight)
    $virtualScreen = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $captureRect = [System.Drawing.Rectangle]::Intersect($windowRect, $virtualScreen)
    if ($captureRect.Width -le 0 -or $captureRect.Height -le 0) {
      throw "window_rect_outside_virtual_screen"
    }

    $bitmap = [System.Drawing.Bitmap]::new($captureRect.Width, $captureRect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($captureRect.Left, $captureRect.Top, 0, 0, $captureRect.Size)

    $pixelStats = Measure-BitmapPixels -Bitmap $bitmap
    $looksCompact = ($windowWidth -ge 60 -and $windowWidth -le 96 -and $windowHeight -ge 60 -and $windowHeight -le 96)
    $looksExpanded = ($windowWidth -ge 300 -and $windowWidth -le 380 -and $windowHeight -ge 330 -and $windowHeight -le 420)
    $oldWhiteBlockLike = (
      ($windowWidth -gt 380 -or $windowHeight -gt 420) -and
      ([double]$pixelStats.nearWhiteRatio -ge 0.70)
    )
    $largeWhiteBlockAbsent = [bool](($looksCompact -or $looksExpanded) -and -not $oldWhiteBlockLike)

    if ($SaveScreenshot) {
      $resolvedScreenshot = Resolve-RepoPath $ScreenshotPath
      $screenshotDir = Split-Path -Parent $resolvedScreenshot
      if (-not (Test-Path -LiteralPath $screenshotDir)) {
        New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null
      }
      $bitmap.Save($resolvedScreenshot, [System.Drawing.Imaging.ImageFormat]::Png)
      $evidence.screenshotSaved = $true
      $evidence.screenshotPath = ConvertTo-RepoRelativePath $resolvedScreenshot
    }

    $evidence.captured = $true
    $evidence.captureWidth = [int]$captureRect.Width
    $evidence.captureHeight = [int]$captureRect.Height
    $evidence.captureClippedToVirtualScreen = [bool](
      $captureRect.Left -ne $windowRect.Left -or
      $captureRect.Top -ne $windowRect.Top -or
      $captureRect.Width -ne $windowRect.Width -or
      $captureRect.Height -ne $windowRect.Height
    )
    $evidence.pixelStats = $pixelStats
    $evidence.largeWhiteBlockAbsent = [bool]$largeWhiteBlockAbsent
    $evidence.oldWhiteBlockLike = [bool]$oldWhiteBlockLike
  } catch {
    $evidence.captureError = $_.Exception.Message
  } finally {
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }

  return $evidence
}

$resolvedReport = Resolve-RepoPath $Report
$reportDir = Split-Path -Parent $resolvedReport
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$pollCount = 0
$deadline = (Get-Date).AddSeconds([Math]::Max(0, $TimeoutSeconds))
do {
  $pollCount += 1
  $windows = @([SmartPromptOverlayVisualNative]::FindMascotWindows())
  if ((Test-OverlayWindowVisuallyReady -Windows $windows) -or (Get-Date) -ge $deadline) {
    break
  }
  Start-Sleep -Milliseconds 250
} while ($true)

$windowMetadatas = @($windows | ForEach-Object { Get-OverlayWindowMetadata -Window $_ })
$primaryWindow = $windows | Where-Object { $_.Visible } | Select-Object -First 1
if ($null -eq $primaryWindow) {
  $primaryWindow = $windows | Select-Object -First 1
}

$primaryMetadata = if ($null -ne $primaryWindow) { Get-OverlayWindowMetadata -Window $primaryWindow } else { $null }
$visualEvidence = if ($null -ne $primaryWindow) {
  Get-OverlayScreenEvidence -Window $primaryWindow -ScreenshotPath $Screenshot -SaveScreenshot ([bool]$AllowScreenshot)
} else {
  $null
}

$windowFound = [bool]($null -ne $primaryWindow)
$noActivate = [bool]($primaryMetadata -and $primaryMetadata.noActivate)
$visible = [bool]($primaryMetadata -and $primaryMetadata.visible)
$geometryOk = [bool]($primaryMetadata -and $primaryMetadata.geometry.matchesExpectedOverlaySize)
$visualOk = [bool]($visualEvidence -and $visualEvidence.captured -and $visualEvidence.largeWhiteBlockAbsent)
$pass = [bool]($windowFound -and $visible -and $noActivate -and $geometryOk -and $visualOk)

$completionImpact = if ($pass) {
  "overlay_window_visual_attach_ready"
} elseif (-not $windowFound) {
  "overlay_window_missing"
} elseif (-not $visible) {
  "overlay_window_not_visible"
} elseif (-not $noActivate) {
  "overlay_no_activate_missing"
} elseif (-not $geometryOk) {
  "overlay_geometry_unexpected"
} elseif (-not ($visualEvidence -and $visualEvidence.captured)) {
  "overlay_screen_capture_failed"
} else {
  "overlay_visual_white_block_suspected"
}

$reportObject = [ordered]@{
  schemaVersion = "p25-overlay-window-visual-attach@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$pass
  completionReady = [bool]$pass
  completionImpact = [string]$completionImpact
  report = ConvertTo-RepoRelativePath $resolvedReport
  wait = [ordered]@{
    timeoutSeconds = [int]$TimeoutSeconds
    pollCount = [int]$pollCount
  }
  windowCount = [int]$windows.Count
  primaryWindow = $primaryMetadata
  windows = $windowMetadatas
  visualEvidence = $visualEvidence
  checks = [ordered]@{
    overlayWindowFound = [bool]$windowFound
    overlayWindowVisible = [bool]$visible
    noActivateStyle = [bool]$noActivate
    geometryMatchesExpectedOverlaySize = [bool]$geometryOk
    screenPixelsCapturedForRatios = [bool]($visualEvidence -and $visualEvidence.captured)
    largeWhiteBlockAbsent = [bool]($visualEvidence -and $visualEvidence.largeWhiteBlockAbsent)
    screenshotSaved = [bool]($visualEvidence -and $visualEvidence.screenshotSaved)
  }
  safety = [ordered]@{
    attachOnly = $true
    processStartAttempted = $false
    stopAttempted = $false
    killAttempted = $false
    replaceAttempted = $false
    realOverlayClickAttempted = $false
    targetWriteAttempted = $false
    screenshotWriteRequiresExplicitAllow = $true
    screenshotWriteAttempted = [bool]$AllowScreenshot
  }
  privacy = [ordered]@{
    noPromptTextRead = $true
    noTargetInputRead = $true
    noRawTitlesStored = $true
    rawUiaNamesNotRead = $true
    clipboardTextNotRead = $true
    screenPixelsReadForRatios = [bool]$windowFound
    rawDesktopPixelsPersisted = [bool]($visualEvidence -and $visualEvidence.screenshotSaved)
    onlyMetadataStored = [bool](-not ($visualEvidence -and $visualEvidence.screenshotSaved))
  }
  scope = [ordered]@{
    verifiesExistingOverlayWindowOnly = $true
    doesNotStartDesktopShell = $true
    doesNotVerifyRealOverlayClick = $true
    doesNotVerifyRealFill = $true
    doesNotVerifySafeCandidate = $true
  }
}

$json = $reportObject | ConvertTo-Json -Depth 14
[System.IO.File]::WriteAllText($resolvedReport, "$json`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "P25 overlay window visual attach report: $resolvedReport"
Write-Host ($reportObject | ConvertTo-Json -Depth 14)

if (-not $AllowFailure -and -not $pass) {
  exit 1
}
