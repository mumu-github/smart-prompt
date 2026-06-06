param(
  [string]$ProfileDir = ".runtime/v2-live-chrome-profile",
  [int]$CdpPort = 9232,
  [string]$ChromePath = "",
  [string]$Url = "https://claude.ai/new",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Resolve-WorkspacePath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

function Resolve-ChromePath {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (Test-Path $ExplicitPath) {
      return [System.IO.Path]::GetFullPath($ExplicitPath)
    }
    throw "ChromePath was provided but does not exist: $ExplicitPath"
  }

  $candidates = @()
  if ($env:CHROME_PATH) {
    $candidates += $env:CHROME_PATH
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  }
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  throw "Chrome was not found. Set CHROME_PATH or pass -ChromePath."
}

function Quote-ProcessArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

$resolvedChrome = Resolve-ChromePath $ChromePath
$resolvedProfile = Resolve-WorkspacePath $ProfileDir
New-Item -ItemType Directory -Force -Path $resolvedProfile | Out-Null

$rawArgs = @(
  "--remote-debugging-port=$CdpPort",
  "--user-data-dir=$resolvedProfile",
  "--no-first-run",
  "--no-default-browser-check",
  $Url
)
$argumentList = ($rawArgs | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
$dryRunCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-v2-claude-cdp.ps1 -DryRun"
$followUpCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-claude-insert.ps1 -AttachCdp -CdpPort $CdpPort"

$result = [ordered]@{
  chromePath = $resolvedChrome
  profileDir = $resolvedProfile
  cdpPort = $CdpPort
  url = $Url
  arguments = $rawArgs
  argumentList = $argumentList
  dryRunCommand = $dryRunCommand
  followUpCommand = $followUpCommand
  nextStep = "Log in to Claude in the opened Chrome window, keep it open, then run followUpCommand."
}

if (-not $DryRun) {
  Start-Process -FilePath $resolvedChrome -ArgumentList $argumentList
}

$result | ConvertTo-Json -Depth 4
