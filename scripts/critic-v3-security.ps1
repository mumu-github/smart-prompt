param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$failures = @()

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

function Require-File {
  param([string]$Path)
  if (-not (Test-Path (Join-Path $Root $Path))) {
    Add-Failure "Missing required file: $Path"
  }
}

function Require-Contains {
  param([string]$Path, [string]$Token, [string]$Label)
  $fullPath = Join-Path $Root $Path
  if (-not (Test-Path $fullPath)) {
    Add-Failure "Missing file for token check: $Path"
    return
  }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  if (-not $content.Contains($Token)) {
    Add-Failure "$Label missing token: $Token"
  }
}

function Require-NotContains {
  param([string]$Path, [string]$Token, [string]$Label)
  $fullPath = Join-Path $Root $Path
  if (-not (Test-Path $fullPath)) {
    Add-Failure "Missing file for forbidden token check: $Path"
    return
  }
  $content = Get-Content -Raw -Encoding UTF8 $fullPath
  if ($content.Contains($Token)) {
    Add-Failure "$Label contains forbidden token: $Token"
  }
}

function Invoke-RepoCommand {
  param([string]$Dir, [string]$Command, [string]$Label)
  Push-Location (Join-Path $Root $Dir)
  try {
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
      Add-Failure "$Label exited with code $LASTEXITCODE"
    }
  } catch {
    Add-Failure "$Label failed: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

$requiredFiles = @(
  "apps/local-service/src/server.js",
  "apps/local-service/src/store.js",
  "apps/local-service/tests/local-service.test.js",
  "prototypes/browser-extension/src/local-service-client.js",
  "prototypes/browser-extension/tests/site-adapters.test.js",
  "apps/desktop-shell/src/app.js",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/src-tauri/capabilities/default.json",
  "apps/desktop-shell/tests/desktop-shell-interaction.test.js",
  "packages/shared/evidence-redaction.js",
  "scripts/test-v3-evidence-redaction.js",
  "scripts/check-v3-security-privacy.js",
  "scripts/check-v3-tauri-security.js",
  "scripts/check-v3-skill-routing.js",
  "scripts/check-v3-live-sites.ps1",
  "scripts/assert-v3-live-formal-evidence.js",
  "scripts/write-v3-release-manifest.js"
)

foreach ($file in $requiredFiles) {
  Require-File $file
}

Require-Contains "apps/local-service/src/server.js" "/auth/bootstrap" "local service auth"
Require-Contains "apps/local-service/src/server.js" "auth_required" "local service auth"
Require-Contains "apps/local-service/src/server.js" "origin_not_allowed" "local service CORS"
Require-Contains "apps/local-service/src/server.js" "timingSafeEqual" "local service token compare"
Require-Contains "apps/local-service/src/server.js" "DEFAULT_ALLOWED_ORIGINS" "local service CORS"
Require-Contains "apps/local-service/src/store.js" "security.json" "local service token store"
Require-Contains "apps/local-service/src/store.js" "getAuthToken" "local service token store"
Require-Contains "prototypes/browser-extension/src/local-service-client.js" "/auth/bootstrap" "browser extension auth client"
Require-Contains "prototypes/browser-extension/src/local-service-client.js" "Authorization" "browser extension auth client"
Require-Contains "apps/desktop-shell/src/app.js" "/auth/bootstrap" "desktop shell auth client"
Require-Contains "apps/desktop-shell/src/app.js" "serviceAuthToken" "desktop shell auth client"
Require-Contains "apps/desktop-shell/src-tauri/tauri.conf.json" "object-src 'none'" "Tauri CSP"
Require-Contains "apps/desktop-shell/src-tauri/capabilities/default.json" "core:event:allow-listen" "Tauri capability"
Require-NotContains "apps/desktop-shell/src-tauri/capabilities/default.json" "core:default" "Tauri capability"
Require-NotContains "apps/desktop-shell/src-tauri/src/main.rs" "tauri_plugin_shell::init" "Tauri shell plugin"
Require-Contains "apps/local-service/src/credential-vault.js" "windows-dpapi" "credential vault"
Require-Contains "apps/local-service/src/store.js" "credentialVault.saveProviderKeys" "credential vault"
Require-Contains "packages/shared/evidence-redaction.js" "redactEvidence" "evidence redaction"
Require-Contains "packages/shared/evidence-redaction.js" "collectRedactionLeaks" "evidence redaction"
Require-Contains "packages/shared/smart-prompt-core.js" "matchedTokens" "skill routing reasons"
Require-Contains "prototypes/browser-extension/tests/live-site-probe.test.js" "redactEvidence" "live-site evidence redaction"
Require-Contains "prototypes/browser-extension/tests/live-site-probe.test.js" "v3-live-site-formal@1" "V3 live-site formal schema"
Require-Contains "prototypes/browser-extension/tests/live-site-probe.test.js" "noAutoSend" "V3 live-site no auto send"
Require-Contains "scripts/check-v3-live-sites.ps1" "SMART_PROMPT_LIVE_INJECT_FALLBACK = `"0`"" "V3 live-site no fallback"
Require-Contains "scripts/assert-v3-live-formal-evidence.js" "summary.noAutoSendPasses" "V3 live-site assertion"
Require-Contains "scripts/check-v2-real-llm.ps1" "redactEvidence" "real LLM evidence redaction"
Require-NotContains "apps/local-service/src/server.js" '"Access-Control-Allow-Origin": "*"' "local service CORS"
Require-NotContains "apps/local-service/src/server.js" "'Access-Control-Allow-Origin': '*'" "local service CORS"

Invoke-RepoCommand "." "node scripts/test-v3-evidence-redaction.js" "V3 evidence redaction tests"
Invoke-RepoCommand "." "node scripts/check-v3-security-privacy.js" "V3 security privacy runtime check"
Invoke-RepoCommand "." "node scripts/check-v3-tauri-security.js" "V3 Tauri security check"
Invoke-RepoCommand "." "node scripts/check-v3-skill-routing.js" "V3 skill routing check"
Invoke-RepoCommand "." "node -c prototypes/browser-extension/tests/live-site-probe.test.js" "live-site probe syntax check"
Invoke-RepoCommand "." "node -c scripts/assert-v3-live-formal-evidence.js" "V3 live-site assertion syntax check"
Invoke-RepoCommand "apps/local-service" "npm test" "local service tests"
Invoke-RepoCommand "prototypes/browser-extension" "npm test" "browser extension tests"
Invoke-RepoCommand "apps/desktop-shell" "npm test" "desktop shell tests"
Invoke-RepoCommand "." "node scripts/write-v3-release-manifest.js" "V3 release manifest writer"

$reportPath = Join-Path $Root "research/v3-security-privacy.latest.json"
if (-not (Test-Path $reportPath)) {
  Add-Failure "Missing V3 security privacy report."
} else {
  try {
    $report = Get-Content -Raw -Encoding UTF8 $reportPath | ConvertFrom-Json
    if (-not $report.pass) {
      Add-Failure "V3 security privacy report pass flag is false."
    }
    foreach ($check in @("healthPublic", "unauthSettingsBlocked", "evilOriginBlocked", "trustedBootstrap", "protectedBearerAccepted", "protectedTokenHeaderAccepted", "corsNoWildcard", "redactionNoLeaks")) {
      if (-not $report.checks.$check) {
        Add-Failure "V3 security privacy report missing passing check: $check"
      }
    }
    $reportText = Get-Content -Raw -Encoding UTF8 $reportPath
    foreach ($pattern in @("sk-", "Bearer local", "C:\\Users\\", "private=1")) {
      if ($reportText.Contains($pattern)) {
        Add-Failure "V3 security privacy report appears to contain unredacted sensitive token: $pattern"
      }
    }
  } catch {
    Add-Failure "Invalid V3 security privacy report: $($_.Exception.Message)"
  }
}

$tauriReportPath = Join-Path $Root "research/v3-tauri-security.latest.json"
if (-not (Test-Path $tauriReportPath)) {
  Add-Failure "Missing V3 Tauri security report."
} else {
  try {
    $tauriReport = Get-Content -Raw -Encoding UTF8 $tauriReportPath | ConvertFrom-Json
    if (-not $tauriReport.pass) {
      Add-Failure "V3 Tauri security report pass flag is false."
    }
    foreach ($check in @("cspConfigured", "cspBlocksDangerousSources", "cspAllowsLocalServiceOnly", "mainWindowLabeled", "globalTauriScoped", "capabilityMainOnly", "capabilityNoWildcard", "capabilityMinimalPermissions", "shellPluginRemoved", "explicitInvokeHandler", "credentialVaultReturnsKeys", "credentialSettingsNoPlaintext", "credentialVaultNoPlaintext", "credentialStorageEncrypted")) {
      if (-not $tauriReport.checks.$check) {
        Add-Failure "V3 Tauri security report missing passing check: $check"
      }
    }
  } catch {
    Add-Failure "Invalid V3 Tauri security report: $($_.Exception.Message)"
  }
}

$skillRoutingReportPath = Join-Path $Root "research/v3-skill-routing.latest.json"
if (-not (Test-Path $skillRoutingReportPath)) {
  Add-Failure "Missing V3 skill routing report."
} else {
  try {
    $skillRoutingReport = Get-Content -Raw -Encoding UTF8 $skillRoutingReportPath | ConvertFrom-Json
    if (-not $skillRoutingReport.pass) {
      Add-Failure "V3 skill routing report pass flag is false."
    }
    if ($skillRoutingReport.fixtureCount -lt 20) {
      Add-Failure "V3 skill routing report has fewer than 20 fixtures."
    }
    if ($skillRoutingReport.hitRate -lt 0.7) {
      Add-Failure "V3 skill routing hit rate below target."
    }
  } catch {
    Add-Failure "Invalid V3 skill routing report: $($_.Exception.Message)"
  }
}

$releaseManifestPath = Join-Path $Root "research/v3-release-manifest.latest.json"
if (-not (Test-Path $releaseManifestPath)) {
  Add-Failure "Missing V3 release manifest."
} else {
  try {
    $releaseManifest = Get-Content -Raw -Encoding UTF8 $releaseManifestPath | ConvertFrom-Json
    if (-not $releaseManifest.pass) {
      Add-Failure "V3 release manifest pass flag is false."
    }
    foreach ($gate in @("LOCAL_SERVICE_SECURITY_PASS", "PRIVACY_CONTEXT_PASS", "NO_AUTO_SEND_PASS", "LIVE_SITE_FORMAL_PASS", "REAL_LLM_SAFE_PASS", "SKILL_ROUTING_PASS", "TAURI_SECURITY_PASS", "V3_RELEASE_MANIFEST_PASS")) {
      if (-not $releaseManifest.acceptance.$gate.status) {
        Add-Failure "V3 release manifest missing gate: $gate"
      }
    }
  } catch {
    Add-Failure "Invalid V3 release manifest: $($_.Exception.Message)"
  }
}

if ($failures.Count -gt 0) {
  Write-Error ("V3 security critic failed:`n - " + ($failures -join "`n - "))
}

Write-Output "PASS: V3 security critic passed."
