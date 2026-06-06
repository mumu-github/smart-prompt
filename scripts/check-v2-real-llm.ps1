$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

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
  @'
const { PROVIDERS, generateWithConfiguredProvider } = require("./packages/shared/llm-gateway");

function chooseProvider() {
  if (process.env.SMART_PROMPT_TEST_PROVIDER) return process.env.SMART_PROMPT_TEST_PROVIDER;
  if (process.env.ANTHROPIC_API_KEY) return PROVIDERS.ANTHROPIC;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return PROVIDERS.GEMINI;
  return PROVIDERS.OPENAI_COMPATIBLE;
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
  const results = [];
  for (const sample of samples) {
    try {
      const card = await generateWithConfiguredProvider({
        input: sample.input,
        context: sample.context,
        skills: [],
        settings: {
          provider,
          baseUrl: process.env.SMART_PROMPT_TEST_BASE_URL || undefined,
          model: chooseModel(provider),
          apiKey: chooseApiKey(provider)
        }
      });
      results.push({
        name: sample.name,
        ok: true,
        provider,
        generatedBy: card.generatedBy,
        mode: card.mode,
        promptLength: card.prompt.length
      });
    } catch (error) {
      results.push({
        name: sample.name,
        ok: false,
        provider,
        code: error.code || "unknown",
        status: error.status || null,
        message: error.message,
        bodyPreview: error.body ? String(error.body).slice(0, 220) : ""
      });
      break;
    }
  }
  console.log(JSON.stringify(results, null, 2));
})();
'@ | node -
} finally {
  Pop-Location
}
