param(
  [string]$Report = "research/v2-real-llm.latest.json",
  [string]$Provider = "",
  [string]$Model = "",
  [string]$BaseUrl = "",
  [string]$DataDir = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptExitCode = 0
if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null

foreach ($name in @("AGNES_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $userKey = [Environment]::GetEnvironmentVariable($name, "User")
    if ($userKey) {
      [Environment]::SetEnvironmentVariable($name, $userKey, "Process")
    }
  }
}

if ($DataDir) {
  if (-not [System.IO.Path]::IsPathRooted($DataDir)) {
    $DataDir = Join-Path $Root $DataDir
  }
  $DataDir = [System.IO.Path]::GetFullPath($DataDir)
}

$previousEnv = @{}
function Set-ScopedEnv {
  param([string]$Name, [string]$Value)
  if (-not $script:previousEnv.ContainsKey($Name)) {
    $script:previousEnv[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
  }
  if ($Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  } else {
    [Environment]::SetEnvironmentVariable($Name, $null, "Process")
  }
}

Push-Location $Root
try {
  Set-ScopedEnv "SMART_PROMPT_REAL_LLM_REPORT" $Report
  if ($Provider) { Set-ScopedEnv "SMART_PROMPT_TEST_PROVIDER" $Provider }
  if ($Model) { Set-ScopedEnv "SMART_PROMPT_TEST_MODEL" $Model }
  if ($BaseUrl) { Set-ScopedEnv "SMART_PROMPT_TEST_BASE_URL" $BaseUrl }
  if ($DataDir) { Set-ScopedEnv "SMART_PROMPT_DATA_DIR" $DataDir }
  if ($DryRun) { Set-ScopedEnv "SMART_PROMPT_REAL_LLM_DRY_RUN" "1" }
  @'
const fs = require("node:fs");
const {
  PROVIDERS,
  chooseConfiguredProvider,
  generateWithConfiguredProvider,
  getConfiguredProviderOrder,
  getProviderDefaults,
  getProviderStatuses
} = require("./packages/shared/llm-gateway");
const { createStore, defaultDataDir } = require("./apps/local-service/src/store");

function chooseProvider(storedSettings) {
  if (process.env.SMART_PROMPT_TEST_PROVIDER) return process.env.SMART_PROMPT_TEST_PROVIDER;
  return storedSettings.provider || PROVIDERS.AUTO;
}

function chooseModel(provider, storedSettings) {
  if (process.env.SMART_PROMPT_TEST_MODEL) return process.env.SMART_PROMPT_TEST_MODEL;
  if (provider && provider !== PROVIDERS.AUTO && provider !== storedSettings.provider) {
    return getProviderDefaults(provider).model;
  }
  return storedSettings.model;
}

function chooseBaseUrl(provider, storedSettings) {
  if (process.env.SMART_PROMPT_TEST_BASE_URL) return process.env.SMART_PROMPT_TEST_BASE_URL;
  if (provider && provider !== PROVIDERS.AUTO && provider !== storedSettings.provider) {
    return getProviderDefaults(provider).baseUrl;
  }
  return storedSettings.baseUrl;
}

function summarizeSettings(settings) {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKey),
    providerKeysAvailable: {
      agnes: Boolean(settings.providerKeys?.agnes),
      "openai-compatible": Boolean(settings.providerKeys?.["openai-compatible"]),
      anthropic: Boolean(settings.providerKeys?.anthropic),
      gemini: Boolean(settings.providerKeys?.gemini)
    }
  };
}

const samples = [
  { name: "idea", input: "", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "continue", input: "帮我做一个 CRM 后台，需要客户列表和跟进记录", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "polish", input: "目标：修复登录模块\n背景：Next.js 项目\n约束：不要改 API\n输出：补丁和验证命令\n验收：测试通过", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } }
];

(async () => {
  const storedSettings = createStore(process.env.SMART_PROMPT_DATA_DIR || undefined).getSettings();
  const provider = chooseProvider(storedSettings);
  const selectedForDefaults = chooseConfiguredProvider({ ...storedSettings, provider });
  const settings = {
    ...storedSettings,
    provider,
    baseUrl: chooseBaseUrl(selectedForDefaults, storedSettings),
    model: chooseModel(selectedForDefaults, storedSettings)
  };
  const selectedProvider = chooseConfiguredProvider(settings);
  const configuredProviders = getConfiguredProviderOrder(settings);
  const providerStatus = getProviderStatuses(settings);
  const results = [];

  if (process.env.SMART_PROMPT_REAL_LLM_DRY_RUN !== "1") {
    for (const sample of samples) {
      try {
        const card = await generateWithConfiguredProvider({
          input: sample.input,
          context: sample.context,
          skills: [],
          settings
        });
        results.push({
          name: sample.name,
          ok: true,
          provider: card.provider,
          generatedBy: card.generatedBy,
          mode: card.mode,
          promptLength: card.prompt.length
        });
      } catch (error) {
        results.push({
          name: sample.name,
          ok: false,
          provider: selectedProvider,
          code: error.code || "unknown",
          status: error.status || null,
          message: error.message,
          attempts: error.attempts || [],
          bodyPreview: error.body ? String(error.body).slice(0, 220) : ""
        });
        break;
      }
    }
  }

  const report = {
    createdAt: new Date().toISOString(),
    dataDir: process.env.SMART_PROMPT_DATA_DIR || defaultDataDir(),
    dryRun: process.env.SMART_PROMPT_REAL_LLM_DRY_RUN === "1",
    requestedProvider: provider,
    selectedProvider,
    configuredProviders,
    settingsSummary: summarizeSettings(settings),
    providerStatus,
    pass: process.env.SMART_PROMPT_REAL_LLM_DRY_RUN !== "1" && results.length === samples.length && results.every((result) => result.ok && result.generatedBy === "llm"),
    results
  };
  if (process.env.SMART_PROMPT_REAL_LLM_REPORT) {
    fs.writeFileSync(process.env.SMART_PROMPT_REAL_LLM_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.dryRun && !report.pass) {
    process.exitCode = 1;
  }
})();
'@ | node -
  $scriptExitCode = $LASTEXITCODE
} finally {
  foreach ($entry in $previousEnv.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
  Pop-Location
}

if ($scriptExitCode -ne 0) {
  exit $scriptExitCode
}
