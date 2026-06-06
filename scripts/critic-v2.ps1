param(
  [switch]$RequireRuntimeEvidence
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$failures = @()

$cargoBin = Join-Path $env:USERPROFILE ".cargo/bin"
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

function Add-Failure {
  param([string]$Message)
  $script:failures += $Message
}

$requiredFiles = @(
  "packages/shared/smart-prompt-core.js",
  "packages/shared/llm-gateway.js",
  "apps/local-service/README.md",
  "apps/local-service/src/server.js",
  "apps/local-service/src/store.js",
  "apps/local-service/src/skill-library.js",
  "apps/local-service/tests/local-service.test.js",
  "prototypes/browser-extension/src/site-adapters.js",
  "prototypes/browser-extension/src/local-service-client.js",
  "prototypes/browser-extension/tests/site-adapters.test.js",
  "prototypes/browser-extension/tests/live-site-probe.test.js",
  "apps/desktop-shell/index.html",
  "apps/desktop-shell/src/app.js",
  "apps/desktop-shell/scripts/tauri-command.js",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/src-tauri/src/main.rs",
  "apps/desktop-shell/tests/desktop-shell.test.js",
  "apps/desktop-shell/tests/tauri-runtime.test.js",
  "research/v2-implementation-rubric.md",
  "research/v2-verification.md",
  "scripts/check-v2-live-sites.ps1",
  "scripts/check-v2-claude-insert.ps1",
  "scripts/check-v2-tauri-runtime.ps1"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path (Join-Path $Root $file))) {
    Add-Failure "Missing V2 file: $file"
  }
}

$commands = @(
  @{ Dir = "apps/local-service"; Cmd = "npm test"; Label = "local service tests" },
  @{ Dir = "prototypes/browser-extension"; Cmd = "npm test"; Label = "browser extension tests" },
  @{ Dir = "apps/desktop-shell"; Cmd = "npm test"; Label = "desktop shell tests" },
  @{ Dir = "apps/desktop-shell"; Cmd = "cargo check --manifest-path src-tauri\Cargo.toml"; Label = "Tauri cargo check" }
)

foreach ($command in $commands) {
  Push-Location (Join-Path $Root $command.Dir)
  try {
    Invoke-Expression $command.Cmd
  } catch {
    Add-Failure ("Failed " + $command.Label)
  } finally {
    Pop-Location
  }
}

$contentPath = Join-Path $Root "prototypes/browser-extension/src/content.js"
if (Test-Path $contentPath) {
  $content = Get-Content -Raw -Encoding UTF8 $contentPath
  if ($content -match "submit\s*\(" -or $content -match "requestSubmit\s*\(" -or $content -match "closest\([""']form[""']\)" -or $content -match "KeyboardEvent\([^)]*Enter") {
    Add-Failure "Browser extension appears to auto-submit or press Enter."
  }
  foreach ($token in @("url: location.href", "title: document.title", "document.body.innerText", "document.documentElement.innerText")) {
    if ($content.Contains($token)) {
      Add-Failure "Browser extension default context may upload sensitive page data: $token"
    }
  }
  if ($content -match "document\.body\.(innerText|textContent|innerHTML)" -or $content -match "document\.documentElement\.(innerText|textContent)") {
    Add-Failure "Browser extension default context appears to read whole-page text."
  }
  if (-not $content.Contains("getPathKind")) {
    Add-Failure "Browser extension should classify path shape without sending the full URL."
  }
  if (-not $content.Contains("location.origin")) {
    Add-Failure "Browser extension should send origin rather than full URL when host context is needed."
  }
}

$localServiceTestPath = Join-Path $Root "apps/local-service/tests/local-service.test.js"
if (Test-Path $localServiceTestPath) {
  $localServiceTest = Get-Content -Raw -Encoding UTF8 $localServiceTestPath
  foreach ($token in @("generateWithLlm", "MODE.IDEA", "MODE.CONTINUE", "MODE.POLISH", "allowTemplateFallback: false", "PROVIDERS.ANTHROPIC", "PROVIDERS.GEMINI", "PROVIDERS.AUTO", "generateWithConfiguredProvider", "chooseConfiguredProvider", "getProviderStatuses", "providerKeys", "getStoredApiKey")) {
    if (-not $localServiceTest.Contains($token)) {
      Add-Failure "Local-service tests missing three-mode LLM gateway coverage token: $token"
    }
  }
}

$siteAdapterTestPath = Join-Path $Root "prototypes/browser-extension/tests/site-adapters.test.js"
if (Test-Path $siteAdapterTestPath) {
  $siteAdapterTest = Get-Content -Raw -Encoding UTF8 $siteAdapterTestPath
  foreach ($token in @("expectedInsertStrategies", "chatgpt", "claude", "gemini", "requestSubmit")) {
    if (-not $siteAdapterTest.Contains($token)) {
      Add-Failure "Browser extension tests missing insert/no-submit coverage token: $token"
    }
  }
}

$localServiceReadmePath = Join-Path $Root "apps/local-service/README.md"
if (Test-Path $localServiceReadmePath) {
  $localServiceReadme = Get-Content -Raw -Encoding UTF8 $localServiceReadmePath
  foreach ($token in @("## API Contract", "GET /settings", "GET /llm/providers", "PUT /settings", "GET /prompts", "POST /prompts", "DELETE /prompts/:id", "POST /skills/import-folder", "POST /skills/recommend", "POST /generate", "allowTemplateFallback", "uploadWholePage", "autoSubmit", "providerKeys", "auto", "openai-compatible", "anthropic", "gemini")) {
    if (-not $localServiceReadme.Contains($token)) {
      Add-Failure "Local-service API contract missing token: $token"
    }
  }
}

$llmGatewayPath = Join-Path $Root "packages/shared/llm-gateway.js"
if (Test-Path $llmGatewayPath) {
  $llmGateway = Get-Content -Raw -Encoding UTF8 $llmGatewayPath
  foreach ($token in @("PROVIDERS", "PROVIDER_ORDER", "chooseConfiguredProvider", "getProviderStatuses", "getStoredApiKey", "createAnthropicMessagesRequest", "createGeminiGenerateContentRequest", "generateWithConfiguredProvider", "anthropic-version", "x-goog-api-key")) {
    if (-not $llmGateway.Contains($token)) {
      Add-Failure "LLM gateway missing provider support token: $token"
    }
  }
}

$localServiceServerPath = Join-Path $Root "apps/local-service/src/server.js"
if (Test-Path $localServiceServerPath) {
  $localServiceServer = Get-Content -Raw -Encoding UTF8 $localServiceServerPath
  foreach ($token in @('GET" && url.pathname === "/prompts', 'POST" && url.pathname === "/prompts', 'DELETE" && url.pathname.startsWith("/prompts/')) {
    if (-not $localServiceServer.Contains($token)) {
      Add-Failure "Local-service prompt library route missing token: $token"
    }
  }
}

$desktopAppPath = Join-Path $Root "apps/desktop-shell/src/app.js"
if (Test-Path $desktopAppPath) {
  $desktopApp = Get-Content -Raw -Encoding UTF8 $desktopAppPath
  foreach ($token in @("/prompts", "/llm/providers", "renderPrompts", "savePrompt", "provider", "PROVIDER_DEFAULTS", "applyProviderDefaults", "renderProviderStatus", "providerKeys", "openai-api-key", "anthropic-api-key", "gemini-api-key")) {
    if (-not $desktopApp.Contains($token)) {
      Add-Failure "Desktop shell prompt library UI missing token: $token"
    }
  }
}

$liveProbePath = Join-Path $Root "prototypes/browser-extension/tests/live-site-probe.test.js"
if (Test-Path $liveProbePath) {
  $liveProbe = Get-Content -Raw -Encoding UTF8 $liveProbePath
  foreach ($token in @("SMART_PROMPT_LIVE_PROFILE_DIR", "SMART_PROMPT_LIVE_SITE_IDS", "SMART_PROMPT_LIVE_LOGIN_WAIT_MS")) {
    if (-not $liveProbe.Contains($token)) {
      Add-Failure "Live-site probe missing authenticated-run support token: $token"
    }
  }
}

$claudeProbePath = Join-Path $Root "scripts/check-v2-claude-insert.ps1"
if (Test-Path $claudeProbePath) {
  $claudeProbe = Get-Content -Raw -Encoding UTF8 $claudeProbePath
  foreach ($token in @("v2-claude-insert.latest.json", "-Report", "-SiteIds claude")) {
    if (-not $claudeProbe.Contains($token)) {
      Add-Failure "Claude insert probe missing separate-report token: $token"
    }
  }
}

$verification = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "research/v2-verification.md")
if ($RequireRuntimeEvidence) {
  $markers = @(
    "LIVE_5_SITES_PASS",
    "INSERT_CHATGPT_PASS",
    "INSERT_CLAUDE_PASS",
    "INSERT_GEMINI_PASS",
    "TAURI_START_PASS",
    "GLOBAL_SHORTCUT_PASS",
    "LOCAL_SERVICE_BRIDGE_PASS"
  )
  foreach ($marker in $markers) {
    $pattern = '(?m)^\s*-\s*`?' + [regex]::Escape($marker) + '`?\b'
    if (-not [regex]::IsMatch($verification, $pattern)) {
      Add-Failure "Missing runtime evidence marker: $marker"
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Error ("V2 audit failed:`n - " + ($failures -join "`n - "))
}

Write-Output "PASS: V2 automated checks passed."
if (-not $RequireRuntimeEvidence) {
  Write-Output "NOTE: runtime evidence was not required for this run; do not mark V2 complete without live-site Insert/display evidence and real LLM quota proof."
}
