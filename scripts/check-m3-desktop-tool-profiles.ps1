param(
  [string]$Report = "",
  [switch]$JsonOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-desktop-tool-profiles.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

$profiles = @("codex", "claude-code", "hermes")
$results = @()

foreach ($profile in $profiles) {
  $rawOutput = ""
  try {
    $outputLines = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "check-m3-desktop-input.ps1") -SelfTest -SelfTestProfile $profile -JsonOnly 2>&1
    $rawOutput = ($outputLines | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw "desktop input self-test failed with exit code $LASTEXITCODE"
    }
    $snapshot = $rawOutput | ConvertFrom-Json
    $rawTitleLeak = $rawOutput.Contains("Smart Prompt Codex UIA Self Test") `
      -or $rawOutput.Contains("Smart Prompt Claude Code UIA Self Test") `
      -or $rawOutput.Contains("Smart Prompt Hermes UIA Self Test") `
      -or $rawOutput.Contains("M3 UIA self test input")
    $ok = [bool](
      $snapshot.schemaVersion -eq "m3-windows-uia@1" `
      -and $snapshot.pass `
      -and $snapshot.selfTest `
      -and $snapshot.selfTestProfile -eq $profile `
      -and $snapshot.foreground.detectedToolProfile -eq $profile `
      -and $snapshot.foreground.expectedToolProfileMatched `
      -and [int]$snapshot.summary.candidateCount -gt 0 `
      -and $snapshot.privacy.titleRedacted `
      -and $snapshot.privacy.elementValuesNotRead `
      -and -not $rawTitleLeak
    )
    $results += [pscustomobject]@{
      id = $profile
      ok = $ok
      schemaVersion = $snapshot.schemaVersion
      detectedToolProfile = $snapshot.foreground.detectedToolProfile
      expectedToolProfileMatched = [bool]$snapshot.foreground.expectedToolProfileMatched
      candidateCount = [int]$snapshot.summary.candidateCount
      valuePatternCandidates = [int]$snapshot.summary.valuePatternCandidates
      textPatternCandidates = [int]$snapshot.summary.textPatternCandidates
      focusableCandidates = [int]$snapshot.summary.focusableCandidates
      titleHash = $snapshot.foreground.titleHash
      titleLength = [int]$snapshot.foreground.titleLength
      privacy = [pscustomobject]@{
        titleRedacted = [bool]$snapshot.privacy.titleRedacted
        elementNamesHashed = [bool]$snapshot.privacy.elementNamesHashed
        elementValuesNotRead = [bool]$snapshot.privacy.elementValuesNotRead
        rawTitleLeak = [bool]$rawTitleLeak
      }
    }
  } catch {
    $results += [pscustomobject]@{
      id = $profile
      ok = $false
      reason = $_.Exception.Message
      outputLength = $rawOutput.Length
    }
  }
}

$passedProfiles = @($results | Where-Object { $_.ok }).Count
$rawLeakCount = @($results | Where-Object { $_.privacy -and $_.privacy.rawTitleLeak }).Count
$reportObject = [pscustomobject]@{
  schemaVersion = "m3-desktop-tool-profiles@1"
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = "win32"
  pass = [bool]($passedProfiles -eq $profiles.Count -and $rawLeakCount -eq 0)
  requiredProfiles = $profiles
  summary = [pscustomobject]@{
    profileCount = $profiles.Count
    passedProfiles = $passedProfiles
    rawLeakCount = $rawLeakCount
  }
  profiles = $results
  privacy = [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotRead = $true
    rawTitlesNotStored = [bool]($rawLeakCount -eq 0)
  }
}

$json = $reportObject | ConvertTo-Json -Depth 8
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 desktop tool profile report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
