param(
  [string]$Report = "research/v4-installer-smoke.latest.json",
  [int]$RemotePort = 9239,
  [int]$ServicePort = 17391
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BundleDir = Join-Path $Root "apps/desktop-shell/src-tauri/target/release/bundle"
$Scratch = Join-Path ([IO.Path]::GetTempPath()) "smart-prompt-v4-installer-smoke"
$InstallDir = Join-Path $Scratch "install"
$ServiceDataDir = Join-Path $Scratch "service-data"
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$ScratchFull = [IO.Path]::GetFullPath($Scratch)

if (-not $ScratchFull.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean a path outside the temp directory: $ScratchFull"
}

if (Test-Path -LiteralPath $ScratchFull) {
  Remove-Item -LiteralPath $ScratchFull -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function ConvertTo-RelativePath([string]$PathValue) {
  $full = [IO.Path]::GetFullPath($PathValue)
  $base = [IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
  if ($full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($base.Length).TrimStart("\", "/").Replace("\", "/")
  }
  return $full.Replace("\", "/")
}

function Invoke-CheckedProcess([string]$FilePath, [string[]]$Arguments) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  return $process.ExitCode
}

function Restore-EnvValue([string]$Name, [object]$Value) {
  if ($null -eq $Value) {
    Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item -LiteralPath "Env:$Name" -Value $Value
  }
}

$installer = Get-ChildItem -LiteralPath $BundleDir -Recurse -File |
  Where-Object { $_.Extension -eq ".exe" -and $_.Name -like "*setup*" } |
  Sort-Object FullName |
  Select-Object -First 1

if (-not $installer) {
  throw "No NSIS setup executable found under $BundleDir. Run apps/desktop-shell npm run build first."
}

$reportObject = [ordered]@{
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  pass = $false
  installer = ConvertTo-RelativePath $installer.FullName
  installDirName = Split-Path -Leaf $InstallDir
  remotePort = $RemotePort
  servicePort = $ServicePort
  checks = [ordered]@{
    installerExists = $true
    installed = $false
    started = $false
    bundledSidecarResource = $false
    bundledNativeSidecar = $false
    sourceCommandBundled = $false
    localServiceStartedFromInstalledApp = $false
    serviceHealthFromInstalledApp = $false
    localServiceStoppedFromInstalledApp = $false
    exited = $false
    uninstalled = $false
  }
}

$appProcess = $null
$oldWebViewArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$oldSmartPromptPort = $env:SMART_PROMPT_PORT
$oldSmartPromptDataDir = $env:SMART_PROMPT_DATA_DIR
try {
  $installExitCode = Invoke-CheckedProcess $installer.FullName @("/S", "/D=$InstallDir")
  $reportObject.installExitCode = $installExitCode
  if ($installExitCode -ne 0) {
    throw "Installer exited with code $installExitCode"
  }

  $installedExe = Get-ChildItem -LiteralPath $InstallDir -Recurse -File -Filter "*.exe" |
    Where-Object { $_.Name -eq "smart-prompt-desktop.exe" } |
    Select-Object -First 1
  if (-not $installedExe) {
    $installedExe = Get-ChildItem -LiteralPath $InstallDir -Recurse -File -Filter "*.exe" |
      Where-Object { $_.Name -notmatch "unins|uninstall" -and $_.Name -notmatch "^local-service-sidecar(\.exe)?$" } |
      Sort-Object Length -Descending |
      Select-Object -First 1
  }
  if (-not $installedExe) {
    throw "Installed app executable was not found in smoke install dir."
  }
  $reportObject.installedExeName = $installedExe.Name
  $reportObject.installedExeBytes = $installedExe.Length
  $reportObject.checks.installed = $true

  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$RemotePort"
  $env:SMART_PROMPT_PORT = "$ServicePort"
  $env:SMART_PROMPT_DATA_DIR = $ServiceDataDir
  $appProcess = Start-Process -FilePath $installedExe.FullName -PassThru -WindowStyle Normal
  Start-Sleep -Seconds 5
  if ($appProcess.HasExited) {
    throw "Installed app exited before smoke startup window."
  }
  $reportObject.processIdObserved = $true
  $reportObject.checks.started = $true

  $runtimeProbe = Join-Path $Root "scripts/check-v4-installed-app-runtime.js"
  $runtimeOutput = & node $runtimeProbe `
    --remote-port "$RemotePort" `
    --service-port "$ServicePort" `
    --install-dir "$InstallDir" 2>&1
  $runtimeExitCode = $LASTEXITCODE
  $runtimeText = ($runtimeOutput | ForEach-Object { $_.ToString() }) -join "`n"
  $reportObject.installedRuntimeRawLength = $runtimeText.Length
  if ($runtimeExitCode -ne 0) {
    $reportObject.installedRuntimeError = $runtimeText
    throw "Installed app runtime probe failed with exit code $runtimeExitCode"
  }
  $runtimeReport = $runtimeText | ConvertFrom-Json
  $reportObject.installedRuntime = $runtimeReport
  $reportObject.checks.bundledSidecarResource = [bool]$runtimeReport.checks.bundledSidecarResource
  $reportObject.checks.bundledNativeSidecar = [bool]$runtimeReport.checks.bundledNativeSidecar
  $reportObject.checks.sourceCommandBundled = [bool]$runtimeReport.checks.sourceCommandBundled
  $reportObject.checks.localServiceStartedFromInstalledApp = [bool]$runtimeReport.checks.localServiceStartedFromInstalledApp
  $reportObject.checks.serviceHealthFromInstalledApp = [bool]$runtimeReport.checks.serviceHealthFromInstalledApp
  $reportObject.checks.localServiceStoppedFromInstalledApp = [bool]$runtimeReport.checks.localServiceStoppedFromInstalledApp

  $closed = $appProcess.CloseMainWindow()
  if ($closed) {
    $appProcess.WaitForExit(7000) | Out-Null
  }
  if (-not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force
    $appProcess.WaitForExit(7000) | Out-Null
    $reportObject.exitMethod = "forced-after-close-request"
  } else {
    $reportObject.exitMethod = "close-main-window"
  }
  $reportObject.checks.exited = $true

  $uninstaller = Get-ChildItem -LiteralPath $InstallDir -Recurse -File -Filter "*.exe" |
    Where-Object { $_.Name -match "unins|uninstall" } |
    Sort-Object FullName |
    Select-Object -First 1
  if (-not $uninstaller) {
    throw "Uninstaller executable was not found in smoke install dir."
  }
  $reportObject.uninstallerName = $uninstaller.Name
  $uninstallExitCode = Invoke-CheckedProcess $uninstaller.FullName @("/S")
  $reportObject.uninstallExitCode = $uninstallExitCode
  if ($uninstallExitCode -ne 0) {
    throw "Uninstaller exited with code $uninstallExitCode"
  }
  Start-Sleep -Seconds 2
  $reportObject.checks.uninstalled = -not (Test-Path -LiteralPath $installedExe.FullName)
  if (-not $reportObject.checks.uninstalled) {
    throw "Installed executable still exists after uninstall."
  }

  $reportObject.pass = $reportObject.checks.installerExists `
    -and $reportObject.checks.installed `
    -and $reportObject.checks.started `
    -and $reportObject.checks.bundledSidecarResource `
    -and $reportObject.checks.bundledNativeSidecar `
    -and $reportObject.checks.sourceCommandBundled `
    -and $reportObject.checks.localServiceStartedFromInstalledApp `
    -and $reportObject.checks.serviceHealthFromInstalledApp `
    -and $reportObject.checks.localServiceStoppedFromInstalledApp `
    -and $reportObject.checks.exited `
    -and $reportObject.checks.uninstalled
} catch {
  $reportObject.error = $_.Exception.Message
  throw
} finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Restore-EnvValue "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" $oldWebViewArgs
  Restore-EnvValue "SMART_PROMPT_PORT" $oldSmartPromptPort
  Restore-EnvValue "SMART_PROMPT_DATA_DIR" $oldSmartPromptDataDir
  $reportPath = Join-Path $Root $Report
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null
  $json = $reportObject | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($reportPath, "$json`n", [Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $ScratchFull) {
    Remove-Item -LiteralPath $ScratchFull -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $reportObject.pass) {
  throw "V4 installer smoke did not pass."
}

Write-Host ($reportObject | ConvertTo-Json -Depth 8)
