param(
  [string]$Report = "",
  [int]$Port = 17442
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$SidecarRoot = Join-Path $Root "apps/local-service-sidecar"
$FillText = "M3 sidecar desktop fill self-test"

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-sidecar-desktop-fill.latest.json"
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

$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) ("smart-prompt-m3-sidecar-fill-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$process = $null

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null,
    [int]$TimeoutSec = 8
  )
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -TimeoutSec $TimeoutSec
  }
  $jsonBody = $Body | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -Body $jsonBody -ContentType "application/json" -TimeoutSec $TimeoutSec
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
  $fillResponse = Invoke-Json -Method POST -Url "http://127.0.0.1:$selectedPort/desktop/fill?selfTest=1" -Headers $headers -Body @{ text = $FillText } -TimeoutSec 20
  $fill = $fillResponse.fill
  $fillJson = $fill | ConvertTo-Json -Depth 10

  $checks = [ordered]@{
    sidecarHealthy = [bool]$health.ok
    authRequired = [bool]$health.authRequired
    fillOk = [bool]$fillResponse.ok
    schema = $fill.schemaVersion
    pass = [bool]$fill.pass
    writeAttempted = [bool]$fill.writeAttempted
    verified = [bool]$fill.verified
    codexProfile = @($fill.supportedToolProfiles) -contains "codex"
    claudeCodeProfile = @($fill.supportedToolProfiles) -contains "claude-code"
    hermesProfile = @($fill.supportedToolProfiles) -contains "hermes"
    privacyWrittenTextNotStored = [bool]$fill.privacy.writtenTextNotStored
    privacyVerificationUsesHash = [bool]$fill.privacy.verificationUsesLengthAndHash
    privacyNoAutoSubmit = -not [bool]$fill.privacy.autoSubmit
    summaryNoAutoSubmit = -not [bool]$fill.summary.autoSubmit
    noSubmitSignals = ([int]$fill.summary.submitSignalCount) -eq 0
    rawTextLeak = $fillJson.Contains($FillText)
  }
  $reportObject = [ordered]@{
    schemaVersion = "m3-sidecar-desktop-fill@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    pass = [bool]($checks.sidecarHealthy -and $checks.fillOk -and ($checks.schema -eq "m3-windows-fill@1") -and $checks.pass -and $checks.writeAttempted -and $checks.verified -and $checks.codexProfile -and $checks.claudeCodeProfile -and $checks.hermesProfile -and $checks.privacyWrittenTextNotStored -and $checks.privacyVerificationUsesHash -and $checks.privacyNoAutoSubmit -and $checks.summaryNoAutoSubmit -and $checks.noSubmitSignals -and -not $checks.rawTextLeak)
    port = $selectedPort
    dataDir = [ordered]@{
      redacted = "REDACTED_PATH"
      length = $dataDir.Length
      sha256 = Get-HashText $dataDir
    }
    requestedText = [ordered]@{
      length = $FillText.Length
      sha256 = Get-HashText $FillText
    }
    checks = $checks
    fill = $fill
  }
  $json = $reportObject | ConvertTo-Json -Depth 10
  Set-ContentWithRetry -Path $Report -Value $json
  Write-Host "M3 sidecar desktop fill report: $Report"
  Write-Output $json
  if (-not $reportObject.pass) {
    throw "M3 sidecar desktop fill report did not pass."
  }
} finally {
  if ($process -and -not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
  }
  Remove-Item -Recurse -Force -LiteralPath $dataDir -ErrorAction SilentlyContinue
}
