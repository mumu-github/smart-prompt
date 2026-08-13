$script:SmartPromptDesktopToolProfileConfig = $null

function Get-SmartPromptDesktopToolProfileConfig {
  if ($script:SmartPromptDesktopToolProfileConfig) {
    return $script:SmartPromptDesktopToolProfileConfig
  }
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $root = Split-Path -Parent $scriptDir
  $configPath = Join-Path $root "packages/shared/desktop-tool-profiles.json"
  $script:SmartPromptDesktopToolProfileConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  return $script:SmartPromptDesktopToolProfileConfig
}

function Get-SmartPromptSupportedToolProfiles {
  $config = Get-SmartPromptDesktopToolProfileConfig
  return @($config.supportedProfiles | ForEach-Object { [string]$_ })
}

function Get-SmartPromptDesktopToolProfilePolicy {
  param([string]$ToolProfile)
  $config = Get-SmartPromptDesktopToolProfileConfig
  $property = $config.policies.PSObject.Properties[$ToolProfile]
  if ($property) { return $property.Value }
  return $null
}

function Get-SmartPromptDesktopToolProfileIds {
  $config = Get-SmartPromptDesktopToolProfileConfig
  return @($config.profiles | ForEach-Object { [string]$_.id })
}

function Test-SmartPromptWeakSignalClipboardFallback {
  param([string]$ToolProfile)
  $policy = Get-SmartPromptDesktopToolProfilePolicy -ToolProfile $ToolProfile
  return [bool]($policy -and $policy.composerGuard -and $policy.composerGuard.allowWeakSignalClipboardFallback)
}

function Test-SmartPromptTrustedOverlayClickProfile {
  param([string]$ToolProfile)
  $config = Get-SmartPromptDesktopToolProfileConfig
  return [bool](@($config.trustedOverlayClickProfiles) -contains $ToolProfile)
}

function Test-SmartPromptTrustedExecutableProfile {
  param([string]$ToolProfile, [string]$ExecutablePath)
  if ([string]::IsNullOrWhiteSpace($ExecutablePath)) { return $false }
  $config = Get-SmartPromptDesktopToolProfileConfig
  $profile = @($config.profiles | Where-Object { [string]$_.id -eq $ToolProfile } | Select-Object -First 1)
  if ($profile.Count -ne 1) { return $false }
  foreach ($pattern in @($profile[0].trustedExecutablePathPatterns)) {
    try {
      if ($ExecutablePath -match [string]$pattern) { return $true }
    } catch {
      # Invalid configuration must fail closed.
    }
  }
  return $false
}

function Test-SmartPromptToolProfileComposerCandidate {
  param([string]$ToolProfile, [object]$Rect, [object]$Signals)
  $policy = Get-SmartPromptDesktopToolProfilePolicy -ToolProfile $ToolProfile
  if (-not $policy -or -not $policy.composerGuard) { return $true }
  if (-not $Rect -or -not $Signals) { return $false }
  $guard = $policy.composerGuard
  $nearWindowBottomOk = -not [bool]$guard.requireNearWindowBottom -or [bool]$Signals.nearWindowBottom
  $broadDocumentOk = -not [bool]$guard.blockBroadDocument -or -not [bool]$Signals.broadDocument
  $geometryLooksLikeComposer = [bool](
    $nearWindowBottomOk -and
    [int]$Rect.width -ge [int]$guard.minWidth -and
    [int]$Rect.height -ge [int]$guard.minHeight -and
    [int]$Rect.height -le [int]$guard.maxHeight -and
    $broadDocumentOk
  )
  $strongInputSignal = $false
  foreach ($signalName in @($guard.strongSignals)) {
    if ([bool]$Signals.$signalName) {
      $strongInputSignal = $true
      break
    }
  }
  return [bool]($geometryLooksLikeComposer -and $strongInputSignal)
}
