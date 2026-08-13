[CmdletBinding()]
param(
  [switch]$JsonOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeTest = Join-Path $repoRoot "apps\local-service\tests\codex-target-adapter.test.js"
$cargoManifest = Join-Path $repoRoot "apps\local-service-sidecar\Cargo.toml"
$fixtureFile = Join-Path $repoRoot "apps\local-service\src\modules\codex-target-adapter\contract-fixtures.json"

if (-not (Test-Path -LiteralPath $nodeTest -PathType Leaf)) {
  throw "Missing Node target-adapter test: $nodeTest"
}
if (-not (Test-Path -LiteralPath $cargoManifest -PathType Leaf)) {
  throw "Missing Rust sidecar manifest: $cargoManifest"
}
if (-not (Test-Path -LiteralPath $fixtureFile -PathType Leaf)) {
  throw "Missing shared target-adapter fixtures: $fixtureFile"
}

$nodeCommand = Get-Command node -ErrorAction Stop
$cargoCommand = Get-Command cargo -ErrorAction Stop
$previousFakeOnly = $env:SMART_PROMPT_FAKE_TARGET_ADAPTER_ONLY

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FileName,
    [Parameter(Mandatory = $true)]
    [string]$Arguments
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FileName
  $startInfo.Arguments = $Arguments
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = (($stdout, $stderr | Where-Object { $_ }) -join "`n").Trim()
  }
}

try {
  $env:SMART_PROMPT_FAKE_TARGET_ADAPTER_ONLY = "1"
  $nodeRun = Invoke-CapturedProcess -FileName $nodeCommand.Source -Arguments "`"$nodeTest`""
  $nodeOutput = $nodeRun.Output
  $nodeExitCode = $nodeRun.ExitCode
  $cargoRun = Invoke-CapturedProcess -FileName $cargoCommand.Source -Arguments "test --manifest-path `"$cargoManifest`" --test target_adapter_contract"
  $cargoOutput = $cargoRun.Output
  $cargoExitCode = $cargoRun.ExitCode
}
finally {
  if ($null -eq $previousFakeOnly) {
    Remove-Item Env:SMART_PROMPT_FAKE_TARGET_ADAPTER_ONLY -ErrorAction SilentlyContinue
  }
  else {
    $env:SMART_PROMPT_FAKE_TARGET_ADAPTER_ONLY = $previousFakeOnly
  }
}

$nodeReport = $null
if ($nodeExitCode -eq 0 -and $nodeOutput) {
  $nodeLastLine = ($nodeOutput -split "`r?`n")[-1]
  try {
    $nodeReport = $nodeLastLine | ConvertFrom-Json
  }
  catch {
    $nodeReport = $null
  }
}

$nodePass = [bool](
  $nodeExitCode -eq 0 -and
  $null -ne $nodeReport -and
  $nodeReport.pass -eq $true -and
  $nodeReport.fakeOnly -eq $true -and
  $nodeReport.realGuiTouched -eq $false -and
  $nodeReport.realClipboardTouched -eq $false -and
  [int]$nodeReport.submitCount -eq 0
)
$rustPass = [bool](
  $cargoExitCode -eq 0 -and
  $cargoOutput -match "test result: ok\. 1 passed; 0 failed"
)
$pass = [bool]($nodePass -and $rustPass)

$report = [ordered]@{
  schemaVersion = "codex-target-adapter-check@1"
  pass = $pass
  fakeOnly = $true
  sharedFixtureSet = if ($nodeReport) { [string]$nodeReport.fixtureSetVersion } else { "unknown" }
  checks = [ordered]@{
    sharedFixturesPresent = $true
    nodeContract = $nodePass
    rustContract = $rustPass
    realGuiTouched = $false
    realClipboardTouched = $false
    submitCount = 0
  }
  commands = @(
    "node apps/local-service/tests/codex-target-adapter.test.js",
    "cargo test --manifest-path apps/local-service-sidecar/Cargo.toml --test target_adapter_contract"
  )
  failure = if ($pass) {
    $null
  }
  else {
    [ordered]@{
      nodeExitCode = $nodeExitCode
      cargoExitCode = $cargoExitCode
      nodeOutputTail = (($nodeOutput -split "`r?`n") | Select-Object -Last 8) -join "`n"
      cargoOutputTail = (($cargoOutput -split "`r?`n") | Select-Object -Last 12) -join "`n"
    }
  }
}

$report | ConvertTo-Json -Depth 6
if (-not $pass) {
  exit 1
}
