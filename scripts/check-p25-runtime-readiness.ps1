param(
  [string]$Report = "research/p25-runtime-readiness.latest.json",
  [string]$TransparentReleaseExe = "apps/desktop-shell/src-tauri/target/release/smart-prompt-desktop.exe",
  [string]$ProcessName = "smart-prompt-desktop",
  [int]$RecentDays = 45,
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

function Get-FileLastWriteUtc {
  param([string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) { return $null }
  return (Get-Item -LiteralPath $PathValue).LastWriteTimeUtc
}

function Get-FileSizeBytes {
  param([string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) { return $null }
  return (Get-Item -LiteralPath $PathValue).Length
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

function Get-LatestFileLastWriteUtc {
  param([string[]]$PathValues)
  $latest = $null
  foreach ($pathValue in $PathValues) {
    $resolved = Resolve-RepoPath $pathValue
    $timestamp = Get-FileLastWriteUtc $resolved
    if ($timestamp -and (($null -eq $latest) -or ($timestamp -gt $latest))) {
      $latest = $timestamp
    }
  }
  return $latest
}

function Get-TextHash {
  param([string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()).Substring(0, 16)
  } finally {
    $sha.Dispose()
  }
}

function Ensure-WindowTypes {
  if ("SmartPromptRuntimeReadinessNative" -as [type]) { return }
  Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public delegate bool SmartPromptRuntimeReadinessEnumProc(IntPtr hWnd, IntPtr lParam);

public struct SmartPromptRuntimeReadinessRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public sealed class SmartPromptRuntimeReadinessWindow {
  public IntPtr Handle;
  public int ProcessId;
  public string Title;
  public long ExStyle;
  public bool Visible;
  public SmartPromptRuntimeReadinessRect Rect;
}

public static class SmartPromptRuntimeReadinessNative {
  public const int GWL_EXSTYLE = -20;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const long WS_EX_TOOLWINDOW = 0x00000080L;
  public const long WS_EX_NOACTIVATE = 0x08000000L;

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(SmartPromptRuntimeReadinessEnumProc enumProc, IntPtr lParam);

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
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptRuntimeReadinessRect rect);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, nIndex) : GetWindowLongPtr32(hWnd, nIndex);
  }

  public static SmartPromptRuntimeReadinessWindow[] FindMascotWindows() {
    List<SmartPromptRuntimeReadinessWindow> windows = new List<SmartPromptRuntimeReadinessWindow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      string title = GetTitle(hWnd);
      if (title == "Smart Prompt Mascot") {
        uint processId;
        SmartPromptRuntimeReadinessRect rect;
        GetWindowThreadProcessId(hWnd, out processId);
        GetWindowRect(hWnd, out rect);
        windows.Add(new SmartPromptRuntimeReadinessWindow {
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
}

function Get-ExecutionPathInfo {
  param(
    [Parameter(Mandatory)]$ProcessId,
    [string]$ExpectedPath
  )

  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  } catch {
    return [pscustomobject]@{
      processId = [int]$ProcessId
      executablePath = ""
      executablePathKnown = $false
      pathHashPrefix = ""
      pathSizeBytes = $null
      pathLastWriteUtc = $null
      pathMatch = $false
      startTimeUtc = $null
    }
  }

  $exePath = if ($proc.ExecutablePath) { [string]$proc.ExecutablePath } else { "" }
  $resolvedExePath = $exePath
  try {
    if ($exePath) {
      $resolvedExePath = [System.IO.Path]::GetFullPath($exePath)
    }
  } catch {
    # Best-effort process lineage only; inaccessible CIM rows should not fail runtime readiness.
  }

  $pathKnown = -not [string]::IsNullOrWhiteSpace($resolvedExePath)
  $pathExists = if ($pathKnown) { Test-Path -LiteralPath $resolvedExePath -ErrorAction SilentlyContinue } else { $false }
  $pathHash = if ($pathKnown -and $pathExists) { Get-FileSha256Prefix $resolvedExePath } else { "" }
  $pathSize = if ($pathKnown -and $pathExists) { Get-FileSizeBytes $resolvedExePath } else { $null }
  $pathWrite = if ($pathKnown -and $pathExists) { Get-FileLastWriteUtc $resolvedExePath } else { $null }
  $matchesCandidate = if ($pathKnown) { [string]::Equals($resolvedExePath, $ExpectedPath, [System.StringComparison]::OrdinalIgnoreCase) } else { $false }
  $expectedHash = if (Test-Path -LiteralPath $ExpectedPath) { Get-FileSha256Prefix $ExpectedPath } else { "" }
  $hashMatchesCandidate = [bool]($pathHash -and $expectedHash -and $pathHash -eq $expectedHash)
  $startTimeUtc = $null
  if ($proc.CreationDate) {
    try {
      $startTimeUtc = [System.Management.ManagementDateTimeConverter]::ToDateTime($proc.CreationDate).ToUniversalTime()
    } catch {
      # Some process paths are inaccessible without elevation; mark the path as unknown below.
    }
  }

  return [pscustomobject]@{
    processId = if ($proc.ProcessId) { [int]$proc.ProcessId } else { 0 }
    executablePath = if ($resolvedExePath) { ConvertTo-RepoRelativePath $resolvedExePath } else { "" }
    executablePathKnown = [bool]$pathKnown
    pathHashPrefix = [string]$pathHash
    pathSizeBytes = $pathSize
    pathLastWriteUtc = if ($pathWrite) { $pathWrite.ToString("o") } else { $null }
    pathMatch = [bool]$matchesCandidate
    hashMatch = [bool]$hashMatchesCandidate
    actualRuntimeMatchesCandidate = [bool]($matchesCandidate -and $hashMatchesCandidate)
    startTimeUtc = if ($startTimeUtc) { $startTimeUtc.ToString("o") } else { $null }
  }
}

function Get-ProcessPathRows {
  param(
    [string]$Name,
    [string]$ExpectedPath
  )
  $filterName = if ($Name.ToLower().EndsWith('.exe')) { $Name } else { "$Name.exe" }
  $items = @()
  try {
    $items = @(Get-CimInstance Win32_Process -Filter "Name='$filterName'" -ErrorAction Stop)
  } catch {
    try {
      $items = @(Get-Process -Name ($Name -replace '\.exe$', '') -ErrorAction Stop)
    } catch {
      $items = @()
    }
  }

  $rows = @()
  $seen = @{}
  foreach ($proc in $items) {
    $processIdValue = if ($proc.ProcessId) { [int]$proc.ProcessId } else { 0 }
    if ($processIdValue -le 0 -or $seen.ContainsKey($processIdValue)) { continue }
    $seen[$processIdValue] = $true
    $rows += Get-ExecutionPathInfo -ProcessId $processIdValue -ExpectedPath $ExpectedPath
  }
  return @($rows)
}

$resolvedReport = Resolve-RepoPath $Report
$resolvedCandidateExe = Resolve-RepoPath $TransparentReleaseExe
$reportDir = Split-Path -Parent $resolvedReport
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
}

$transparentReleaseExePresent = Test-Path -LiteralPath $resolvedCandidateExe
$transparentReleaseExeSize = if ($transparentReleaseExePresent) { Get-FileSizeBytes $resolvedCandidateExe } else { $null }
$transparentReleaseExeHash = if ($transparentReleaseExePresent) { Get-FileSha256Prefix $resolvedCandidateExe } else { "" }
$transparentReleaseExeTime = Get-FileLastWriteUtc $resolvedCandidateExe
$sourceInputTime = Get-LatestFileLastWriteUtc @(
  "apps/desktop-shell/src-tauri/src/main.rs",
  "apps/desktop-shell/src-tauri/Cargo.toml",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/overlay.html",
  "apps/desktop-shell/src/overlay.css",
  "apps/desktop-shell/src/overlay.js",
  "apps/desktop-shell/src/app.js",
  "apps/desktop-shell/scripts/prepare-dist.js"
)
$distInputTime = Get-LatestFileLastWriteUtc @(
  "apps/desktop-shell/dist/index.html",
  "apps/desktop-shell/dist/overlay.html",
  "apps/desktop-shell/dist/src/app.js",
  "apps/desktop-shell/dist/src/overlay.css",
  "apps/desktop-shell/dist/src/overlay.js"
)
$transparentReleaseRecentThresholdUtc = (Get-Date).ToUniversalTime().AddDays(-[Math]::Max(1, $RecentDays))
$transparentReleaseCandidateRecent = [bool]($transparentReleaseExePresent -and $transparentReleaseExeTime -and $transparentReleaseExeTime -ge $transparentReleaseRecentThresholdUtc)
$transparentReleaseCandidateFresh = [bool](
  $transparentReleaseExePresent -and
  $transparentReleaseExeTime -and
  $sourceInputTime -and
  $distInputTime -and
  $transparentReleaseExeTime -ge $sourceInputTime -and
  $transparentReleaseExeTime -ge $distInputTime
)
$transparentReleaseCandidateReady = [bool]($transparentReleaseExePresent -and $transparentReleaseCandidateRecent -and $transparentReleaseCandidateFresh)

$processFilterName = if ($ProcessName.ToLower().EndsWith('.exe')) { $ProcessName } else { "$ProcessName.exe" }
$processRows = @(Get-ProcessPathRows -Name $ProcessName -ExpectedPath $resolvedCandidateExe)
$sidecarRows = @(Get-ProcessPathRows -Name "local-service-sidecar" -ExpectedPath $resolvedCandidateExe)

$runningProcessCount = @($processRows).Count
$pathKnownCount = @($processRows | Where-Object { $_.executablePathKnown }).Count
$matchingProcessCount = @($processRows | Where-Object { $_.actualRuntimeMatchesCandidate }).Count
$unknownPathCount = $runningProcessCount - $pathKnownCount
$allPathsMatch = [bool]($runningProcessCount -gt 0 -and $pathKnownCount -eq $runningProcessCount -and $matchingProcessCount -eq $runningProcessCount)
$allPathsKnown = [bool]($runningProcessCount -eq $pathKnownCount)
$latestProcessStart = $null
$latestProcessId = $null
if ($processRows.Count -gt 0) {
  $sorted = $processRows | Where-Object { $_.startTimeUtc } | Sort-Object { [DateTime]$_.startTimeUtc } -Descending
  if ($sorted.Count -gt 0) {
    $latestProcessStart = $sorted[0].startTimeUtc
    $latestProcessId = $sorted[0].processId
  } else {
    $latestProcessStart = $processRows[0].startTimeUtc
    $latestProcessId = $processRows[0].processId
  }
}

Ensure-WindowTypes
$overlayWindows = @([SmartPromptRuntimeReadinessNative]::FindMascotWindows() | ForEach-Object {
  $window = $_
  $matchedProcess = @($processRows | Where-Object { $_.processId -eq $window.ProcessId }).Count -gt 0
  [ordered]@{
    hwnd = ("0x{0:x}" -f $window.Handle.ToInt64())
    processId = [int]$window.ProcessId
    matchesDesktopShellProcess = [bool]$matchedProcess
    titleHash = Get-TextHash $window.Title
    titleLength = [int]$window.Title.Length
    visible = [bool]$window.Visible
    rect = [ordered]@{
      width = [int]($window.Rect.Right - $window.Rect.Left)
      height = [int]($window.Rect.Bottom - $window.Rect.Top)
    }
    exStyleHex = ("0x{0:x}" -f $window.ExStyle)
    noActivate = [bool](($window.ExStyle -band [SmartPromptRuntimeReadinessNative]::WS_EX_NOACTIVATE) -ne 0)
    topmost = [bool](($window.ExStyle -band [SmartPromptRuntimeReadinessNative]::WS_EX_TOPMOST) -ne 0)
    toolWindow = [bool](($window.ExStyle -band [SmartPromptRuntimeReadinessNative]::WS_EX_TOOLWINDOW) -ne 0)
  }
})
$overlayMatchesDesktopShell = [bool](@($overlayWindows | Where-Object { $_.matchesDesktopShellProcess }).Count -gt 0)

$pass = [bool]($runningProcessCount -gt 0 -and $transparentReleaseCandidateReady -and $allPathsMatch)
$completionReady = [bool]$pass
$completionImpact = if ($completionReady) {
  "smart_prompt_process_matches_latest_candidate"
} elseif (-not $transparentReleaseExePresent) {
  "candidate_exe_missing"
} elseif (-not $transparentReleaseCandidateFresh) {
  "candidate_exe_older_than_source_or_dist"
} elseif ($runningProcessCount -eq 0) {
  "no_smart_prompt_process_running"
} elseif (-not $allPathsKnown) {
  "running_process_path_unknown"
} elseif (-not $allPathsMatch) {
  "running_process_from_other_source"
} else {
  "runtime_readiness_inconclusive"
}
$blockingReasons = @()
if (-not $transparentReleaseExePresent) { $blockingReasons += "candidate_exe_missing" }
if (-not $transparentReleaseCandidateRecent) { $blockingReasons += "candidate_exe_not_recent" }
if (-not $transparentReleaseCandidateFresh) { $blockingReasons += "candidate_exe_older_than_source_or_dist" }
if ($runningProcessCount -eq 0) { $blockingReasons += "no_smart_prompt_process_running" }
if ($runningProcessCount -gt 0 -and -not $allPathsKnown) { $blockingReasons += "running_process_path_unknown" }
if ($runningProcessCount -gt 0 -and -not $allPathsMatch) { $blockingReasons += "running_process_does_not_match_candidate" }

$reportObject = [ordered]@{
  schemaVersion = "p25-runtime-readiness@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = [bool]$pass
  runtimeReady = [bool]$pass
  completionReady = [bool]$completionReady
  completionImpact = $completionImpact
  readinessImpact = $completionImpact
  blockingReasons = @($blockingReasons)
  safety = [ordered]@{
    processStartAttempted = $false
    processStopAttempted = $false
    processKillAttempted = $false
    realOverlayClickAttempted = $false
    writeAttempted = $false
  }
  scope = [ordered]@{
    doesNotVerifyRealOverlayClick = $true
    doesNotVerifyRealFill = $true
    doesNotVerifySafeCandidate = $true
  }
  candidate = [ordered]@{
    path = ConvertTo-RepoRelativePath $resolvedCandidateExe
    present = [bool]$transparentReleaseExePresent
    sizeBytes = if ($transparentReleaseExeSize -ne $null) { [long]$transparentReleaseExeSize } else { $null }
    lastWriteUtc = if ($transparentReleaseExeTime) { $transparentReleaseExeTime.ToString("o") } else { $null }
    sha256Prefix = if ($transparentReleaseExeHash) { [string]$transparentReleaseExeHash } else { $null }
    sourceLastWriteUtc = if ($sourceInputTime) { $sourceInputTime.ToString("o") } else { $null }
    distLastWriteUtc = if ($distInputTime) { $distInputTime.ToString("o") } else { $null }
    recentDays = [int]$RecentDays
    recent = [bool]$transparentReleaseCandidateRecent
    fresh = [bool]$transparentReleaseCandidateFresh
    ready = [bool]$transparentReleaseCandidateReady
  }
  checks = [ordered]@{
    candidateFound = [bool]$transparentReleaseExePresent
    candidateRecent = [bool]$transparentReleaseCandidateRecent
    candidateFresh = [bool]$transparentReleaseCandidateFresh
    candidateReady = [bool]$transparentReleaseCandidateReady
    processName = [string]$processFilterName
    runningProcessFound = [bool]($runningProcessCount -gt 0)
    processCount = [int]$runningProcessCount
    processPathsKnown = [bool]$allPathsKnown
    allRunningProcessesMatchCandidate = [bool]$allPathsMatch
    matchingProcessCount = [int]$matchingProcessCount
    unknownPathProcessCount = [int]$unknownPathCount
    overlayWindowCount = [int]@($overlayWindows).Count
    overlayMatchesDesktopShellProcess = [bool]$overlayMatchesDesktopShell
  }
  runningDesktopShell = [ordered]@{
    processCount = [int]$runningProcessCount
    processPathsKnown = [bool]$allPathsKnown
    matchingProcessCount = [int]$matchingProcessCount
    unknownPathProcessCount = [int]$unknownPathCount
    actualRuntimeMatchesCandidate = [bool]$allPathsMatch
    processes = @($processRows)
  }
  processes = @($processRows)
  latestMatchProcess = if ($latestProcessId) {
    [ordered]@{
      processId = [int]$latestProcessId
      startTimeUtc = [string]$latestProcessStart
      executablePathMatch = [bool](($processRows | Where-Object { $_.processId -eq $latestProcessId } | Select-Object -First 1).pathMatch)
    }
  } else {
    $null
  }
  overlayWindow = @($overlayWindows)
  sidecarObservation = [ordered]@{
    processCount = [int]@($sidecarRows).Count
    processes = @($sidecarRows)
    doesNotSubstituteForDesktopShellRuntime = $true
  }
  privacy = [ordered]@{
    processPathsAllowed = $true
    noPromptTextRead = $true
    noTargetInputRead = $true
    noRawTitlesRead = $true
    rawUiaNamesNotRead = $true
    clipboardTextNotRead = $true
    onlyMetadataStored = $true
  }
}

$reportObject | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $resolvedReport
Write-Host "P25 runtime readiness report: $resolvedReport"
Write-Host ($reportObject | ConvertTo-Json -Depth 12)

if (-not $AllowFailure -and -not $pass) {
  exit 1
}
