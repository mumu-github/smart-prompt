const { buildLlmMessages } = require("./smart-prompt-core");

const PROVIDERS = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini"
});

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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

function createAnthropicMessagesRequest({ input, context, skills, variantIndex, settings }) {
  const { card, messages } = buildLlmMessages(input, context, skills, variantIndex);
  const model = settings?.model || DEFAULT_ANTHROPIC_MODEL;
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const user = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    card,
    endpoint: `${(settings?.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/$/, "")}/messages`,
    body: {
      model,
      max_tokens: Number.isFinite(settings?.maxTokens) ? settings.maxTokens : 2000,
      temperature: Number.isFinite(settings?.temperature) ? settings.temperature : 0.35,
      system,
      messages: [{ role: "user", content: user }]
    }
  };
}

function createGeminiGenerateContentRequest({ input, context, skills, variantIndex, settings }) {
  const { card, messages } = buildLlmMessages(input, context, skills, variantIndex);
  const model = settings?.model || DEFAULT_GEMINI_MODEL;
  const modelPath = String(model).startsWith("models/") ? model : `models/${model}`;
  const prompt = messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
  return {
    card,
    endpoint: `${(settings?.baseUrl || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, "")}/${modelPath}:generateContent`,
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: Number.isFinite(settings?.temperature) ? settings.temperature : 0.35
      }
    }
  };
}

function getApiKey(provider, settings = {}) {
  if (settings.apiKey) return settings.apiKey;
  if (provider === PROVIDERS.ANTHROPIC) return process.env.ANTHROPIC_API_KEY;
  if (provider === PROVIDERS.GEMINI) return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function getFetcher(fetchImpl) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") {
    const error = new Error("No fetch implementation is available for LLM generation.");
    error.code = "missing_fetch";
    throw error;
  }
  return fetcher;
}

async function postJson({ request, headers, fetchImpl }) {
  const fetcher = getFetcher(fetchImpl);
  const response = await fetcher(request.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
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

  return response.json();
}

function extractAnthropicText(data) {
  return (data?.content || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

function extractGeminiText(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

function finishCard(request, prompt) {
  if (!prompt) {
    const error = new Error("LLM response did not contain prompt text.");
    error.code = "empty_llm_response";
    throw error;
  }
  const contextMessage = request.body.messages?.find((message) => String(message.content || "").includes("Context summary"));
  const contextText = contextMessage?.content || request.body.messages?.[0]?.content || request.body.contents?.[0]?.parts?.[0]?.text || "";
  return {
    ...request.card,
    prompt,
    generatedBy: "llm",
    model: request.body.model || request.endpoint.match(/\/models\/([^:/]+)/)?.[1] || "",
    contextSummary: contextText.split("\n")[0] || ""
  };
}

async function generateWithOpenAICompatible({ input, context, skills, variantIndex, settings = {}, fetchImpl }) {
  const provider = PROVIDERS.OPENAI_COMPATIBLE;
  const apiKey = getApiKey(provider, settings);
  const request = createOpenAIChatRequest({ input, context, skills, variantIndex, settings });
  if (!apiKey) {
    const error = new Error("Missing API key for real LLM generation.");
    error.code = "missing_api_key";
    error.request = { ...request, apiKey: "" };
    throw error;
  }

  const data = await postJson({
    request,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetchImpl
  });
  const prompt = data?.choices?.[0]?.message?.content?.trim();
  const card = finishCard(request, prompt);
  return { ...card, provider };
}

async function generateWithAnthropic({ input, context, skills, variantIndex, settings = {}, fetchImpl }) {
  const provider = PROVIDERS.ANTHROPIC;
  const apiKey = getApiKey(provider, settings);
  const request = createAnthropicMessagesRequest({ input, context, skills, variantIndex, settings });
  if (!apiKey) {
    const error = new Error("Missing API key for Anthropic generation.");
    error.code = "missing_api_key";
    error.request = { ...request, apiKey: "" };
    throw error;
  }

  const data = await postJson({
    request,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": settings.anthropicVersion || DEFAULT_ANTHROPIC_VERSION
    },
    fetchImpl
  });
  const card = finishCard(request, extractAnthropicText(data));
  return { ...card, provider };
}

async function generateWithGemini({ input, context, skills, variantIndex, settings = {}, fetchImpl }) {
  const provider = PROVIDERS.GEMINI;
  const apiKey = getApiKey(provider, settings);
  const request = createGeminiGenerateContentRequest({ input, context, skills, variantIndex, settings });
  if (!apiKey) {
    const error = new Error("Missing API key for Gemini generation.");
    error.code = "missing_api_key";
    error.request = { ...request, apiKey: "" };
    throw error;
  }

  const data = await postJson({
    request,
    headers: { "x-goog-api-key": apiKey },
    fetchImpl
  });
  const card = finishCard(request, extractGeminiText(data));
  return { ...card, provider };
}

function normalizeProvider(provider) {
  return Object.values(PROVIDERS).includes(provider) ? provider : PROVIDERS.OPENAI_COMPATIBLE;
}

async function generateWithConfiguredProvider(args) {
  const provider = normalizeProvider(args.settings?.provider);
  if (provider === PROVIDERS.ANTHROPIC) return generateWithAnthropic(args);
  if (provider === PROVIDERS.GEMINI) return generateWithGemini(args);
  return generateWithOpenAICompatible(args);
}

module.exports = {
  PROVIDERS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  createAnthropicMessagesRequest,
  createGeminiGenerateContentRequest,
  createOpenAIChatRequest,
  generateWithAnthropic,
  generateWithConfiguredProvider,
  generateWithGemini,
  generateWithOpenAICompatible,
  redactKey
};
