const { buildLlmMessages } = require("./smart-prompt-core");

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function redactKey(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 8) return "********";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function createOpenAIChatRequest({ input, context, skills, variantIndex, settings }) {
  const { card, messages } = buildLlmMessages(input, context, skills, variantIndex);
  const model = settings?.model || DEFAULT_MODEL;
  return {
    card,
    endpoint: `${(settings?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`,
    body: {
      model,
      temperature: Number.isFinite(settings?.temperature) ? settings.temperature : 0.35,
      messages
    }
  };
}

async function generateWithOpenAICompatible({ input, context, skills, variantIndex, settings, fetchImpl }) {
  const apiKey = settings?.apiKey || process.env.OPENAI_API_KEY;
  const request = createOpenAIChatRequest({ input, context, skills, variantIndex, settings });
  if (!apiKey) {
    const error = new Error("Missing API key for real LLM generation.");
    error.code = "missing_api_key";
    error.request = { ...request, apiKey: "" };
    throw error;
  }

  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    const error = new Error("No fetch implementation is available for LLM generation.");
    error.code = "missing_fetch";
    throw error;
  }

  const response = await fetcher(request.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request.body)
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`LLM request failed with ${response.status}.`);
    error.code = "llm_request_failed";
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const data = await response.json();
  const prompt = data?.choices?.[0]?.message?.content?.trim();
  if (!prompt) {
    const error = new Error("LLM response did not contain prompt text.");
    error.code = "empty_llm_response";
    error.body = data;
    throw error;
  }

  return {
    ...request.card,
    prompt,
    generatedBy: "llm",
    model: request.body.model,
    contextSummary: request.body.messages[1].content.split("\n")[0]
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  createOpenAIChatRequest,
  generateWithOpenAICompatible,
  redactKey
};
