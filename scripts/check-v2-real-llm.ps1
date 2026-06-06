$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $env:OPENAI_API_KEY) {
  $userKey = [Environment]::GetEnvironmentVariable("OPENAI_API_KEY", "User")
  if ($userKey) {
    $env:OPENAI_API_KEY = $userKey
  }
}

if (-not $env:OPENAI_API_KEY) {
  throw "OPENAI_API_KEY is not set in process or User environment."
}

Push-Location $Root
try {
  @'
const { generateWithOpenAICompatible } = require("./packages/shared/llm-gateway");

const samples = [
  { name: "idea", input: "", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "continue", input: "帮我做一个 CRM 后台，需要客户列表和跟进记录", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } },
  { name: "polish", input: "目标：修复登录模块\n背景：Next.js 项目\n约束：不要改 API\n输出：补丁和验证命令\n验收：测试通过", context: { tool: "ChatGPT", host: "chatgpt.com", inputKind: "textarea" } }
];

(async () => {
  const results = [];
  for (const sample of samples) {
    try {
      const card = await generateWithOpenAICompatible({
        input: sample.input,
        context: sample.context,
        skills: [],
        settings: {
          model: process.env.SMART_PROMPT_TEST_MODEL || "gpt-4o-mini",
          apiKey: process.env.OPENAI_API_KEY
        }
      });
      results.push({
        name: sample.name,
        ok: true,
        generatedBy: card.generatedBy,
        mode: card.mode,
        promptLength: card.prompt.length
      });
    } catch (error) {
      results.push({
        name: sample.name,
        ok: false,
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
