param(
  [string]$Report = "research/v2-real-llm.latest.json"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null

foreach ($name in @("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $userKey = [Environment]::GetEnvironmentVariable($name, "User")
    if ($userKey) {
      [Environment]::SetEnvironmentVariable($name, $userKey, "Process")
    }
  }
}

if (-not ($env:OPENAI_API_KEY -or $env:ANTHROPIC_API_KEY -or $env:GEMINI_API_KEY -or $env:GOOGLE_API_KEY)) {
  throw "No LLM API key is set. Configure OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY."
}

Push-Location $Root
try {
  $env:SMART_PROMPT_REAL_LLM_REPORT = $Report
  @'
const fs = require("node:fs");
const { PROVIDERS, chooseConfiguredProvider, generateWithConfiguredProvider } = require("./packages/shared/llm-gateway");

function chooseProvider() {
  if (process.env.SMART_PROMPT_TEST_PROVIDER) return process.env.SMART_PROMPT_TEST_PROVIDER;
  return PROVIDERS.AUTO;
}

function chooseApiKey(provider) {
  if (provider === PROVIDERS.ANTHROPIC) return process.env.ANTHROPIC_API_KEY;
  if (provider === PROVIDERS.GEMINI) return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function chooseModel(provider) {
  if (process.env.SMART_PROMPT_TEST_MODEL) return process.env.SMART_PROMPT_TEST_MODEL;
  if (provider === PROVIDERS.ANTHROPIC) return "claude-sonnet-4-20250514";
  if (provider === PROVIDERS.GEMINI) return "gemini-2.5-flash";
  return "gpt-4o-mini";
}

const samples = [
  { name: "idea", input: "", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "continue", input: "帮我做一个 CRM 后台，需要客户列表和跟进记录", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "polish", input: "目标：修复登录模块\n背景：Next.js 项目\n约束：不要改 API\n输出：补丁和验证命令\n验收：测试通过", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } }
];

(async () => {
  const provider = chooseProvider();
  const settings = {
    provider,
    baseUrl: process.env.SMART_PROMPT_TEST_BASE_URL || undefined,
    model: chooseModel(chooseConfiguredProvider({ provider })),
    apiKey: chooseApiKey(chooseConfiguredProvider({ provider }))
  };
  const selectedProvider = chooseConfiguredProvider(settings);
  const results = [];
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
        bodyPreview: error.body ? String(error.body).slice(0, 220) : ""
      });
      break;
    }
  }
  const report = {
    createdAt: new Date().toISOString(),
    requestedProvider: provider,
    selectedProvider,
    pass: results.length === samples.length && results.every((result) => result.ok && result.generatedBy === "llm"),
    results
  };
  if (process.env.SMART_PROMPT_REAL_LLM_REPORT) {
    fs.writeFileSync(process.env.SMART_PROMPT_REAL_LLM_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
})();
'@ | node -
} finally {
  Remove-Item Env:\SMART_PROMPT_REAL_LLM_REPORT -ErrorAction SilentlyContinue
  Pop-Location
}
