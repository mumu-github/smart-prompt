param(
  [string]$Report = "",
  [int]$Port = 17441
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$SidecarRoot = Join-Path $Root "apps/local-service-sidecar"

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-sidecar-desktop-input.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null

function Get-HashText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace "-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

$cargo = "cargo"
$userCargo = Join-Path $env:USERPROFILE ".cargo/bin/cargo.exe"
if (Test-Path $userCargo) {
  $cargo = $userCargo
}

Push-Location $SidecarRoot
try {
  & $cargo build
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$exe = Join-Path $SidecarRoot "target/debug/local-service-sidecar.exe"
if (-not (Test-Path $exe)) {
  $exe = Join-Path $SidecarRoot "target/debug/local-service-sidecar"
}
if (-not (Test-Path $exe)) {
  throw "local-service-sidecar executable was not built."
}

$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) ("smart-prompt-m3-sidecar-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$process = $null

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{}
  )
  Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -TimeoutSec 5
}

function Set-ContentWithRetry {
  param(
    [string]$Path,
    [string]$Value
  )
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    try {
      Set-Content -Path $Path -Value $Value -Encoding UTF8
      return
    } catch {
      if ($attempt -eq 9) { throw }
      Start-Sleep -Milliseconds 200
    }
  }
}

try {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $exe
  $startInfo.WorkingDirectory = $Root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables["SMART_PROMPT_PORT"] = [string]$Port
  $startInfo.EnvironmentVariables["SMART_PROMPT_DATA_DIR"] = $dataDir
  $process = [System.Diagnostics.Process]::Start($startInfo)

  $selectedPort = $null
  $health = $null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and -not $selectedPort) {
    foreach ($candidatePort in $Port..($Port + 5)) {
      try {
        $health = Invoke-Json -Method GET -Url "http://127.0.0.1:$candidatePort/health"
        if ($health.ok) {
          $selectedPort = $candidatePort
          break
        }
      } catch {
        Start-Sleep -Milliseconds 120
      }
    }
  }
  if (-not $selectedPort) {
    throw "native sidecar did not become healthy."
  }

  $auth = Invoke-Json -Method GET -Url "http://127.0.0.1:$selectedPort/auth/bootstrap"
  $headers = @{ Authorization = "Bearer $($auth.auth.token)" }
  $snapshotResponse = Invoke-Json -Method GET -Url "http://127.0.0.1:$selectedPort/desktop/input-snapshot?selfTest=1" -Headers $headers
  $snapshot = $snapshotResponse.snapshot

  $checks = [ordered]@{
    sidecarHealthy = [bool]$health.ok
    authRequired = [bool]$health.authRequired
    snapshotOk = [bool]$snapshotResponse.ok
    schema = $snapshot.schemaVersion
    pass = [bool]$snapshot.pass
    candidateCount = [int]$snapshot.summary.candidateCount
    codexProfile = @($snapshot.supportedToolProfiles) -contains "codex"
    claudeCodeProfile = @($snapshot.supportedToolProfiles) -contains "claude-code"
    hermesProfile = @($snapshot.supportedToolProfiles) -contains "hermes"
    privacyTitleRedacted = [bool]$snapshot.privacy.titleRedacted
    privacyValuesNotRead = [bool]$snapshot.privacy.elementValuesNotRead
  }
  $reportObject = [ordered]@{
    schemaVersion = "m3-sidecar-desktop-input@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    pass = [bool]($checks.sidecarHealthy -and $checks.snapshotOk -and $checks.pass -and $checks.candidateCount -gt 0 -and $checks.codexProfile -and $checks.claudeCodeProfile -and $checks.hermesProfile -and $checks.privacyTitleRedacted -and $checks.privacyValuesNotRead)
    port = $selectedPort
    dataDir = [ordered]@{
      redacted = "REDACTED_PATH"
      length = $dataDir.Length
      sha256 = Get-HashText $dataDir
    }
    checks = $checks
    snapshot = $snapshot
  }
  $json = $reportObject | ConvertTo-Json -Depth 10
  Set-ContentWithRetry -Path $Report -Value $json
  Write-Host "M3 sidecar desktop input report: $Report"
  Write-Output $json
  if (-not $reportObject.pass) {
    throw "M3 sidecar desktop input report did not pass."
  }
} finally {
  if ($process -and -not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
  }
  Remove-Item -Recurse -Force -LiteralPath $dataDir -ErrorAction SilentlyContinue
}
