const { buildLlmMessages } = require("./smart-prompt-core");

const PROVIDERS = Object.freeze({
  AUTO: "auto",
  AGNES: "agnes",
  OPENAI_COMPATIBLE: "openai-compatible",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini"
});

const PROVIDER_ORDER = Object.freeze([
  PROVIDERS.AGNES,
  PROVIDERS.ANTHROPIC,
  PROVIDERS.GEMINI,
  PROVIDERS.OPENAI_COMPATIBLE
]);

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_AGNES_MODEL = "agnes-2.0-flash";
const DEFAULT_AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";

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

function getProviderDefaults(provider) {
  if (provider === PROVIDERS.AGNES) {
    return {
      provider,
      label: "Agnes",
      baseUrl: DEFAULT_AGNES_BASE_URL,
      model: DEFAULT_AGNES_MODEL,
      envKeys: ["AGNES_API_KEY"]
    };
  }
  if (provider === PROVIDERS.ANTHROPIC) {
    return {
      provider,
      label: "Anthropic",
      baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
      model: DEFAULT_ANTHROPIC_MODEL,
      envKeys: ["ANTHROPIC_API_KEY"]
    };
  }
  if (provider === PROVIDERS.GEMINI) {
    return {
      provider,
      label: "Gemini",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: DEFAULT_GEMINI_MODEL,
      envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
    };
  }
  return {
    provider: PROVIDERS.OPENAI_COMPATIBLE,
    label: "OpenAI-compatible",
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    envKeys: ["OPENAI_API_KEY"]
  };
}

function getEnvKey(provider, env = process.env) {
  const defaults = getProviderDefaults(provider);
  return defaults.envKeys.find((name) => env[name]) || "";
}

function getStoredApiKey(provider, settings = {}) {
  const providerKey = settings.providerKeys?.[provider];
  if (providerKey) return providerKey;

  const selected = normalizeProvider(settings.provider);
  if (settings.apiKey && (selected === provider || (selected === PROVIDERS.AUTO && provider === PROVIDERS.OPENAI_COMPATIBLE))) {
    return settings.apiKey;
  }
  return "";
}

function getApiKey(provider, settings = {}, env = process.env) {
  const storedKey = getStoredApiKey(provider, settings);
  if (storedKey) return storedKey;
  const envKey = getEnvKey(provider, env);
  return envKey ? env[envKey] : "";
}

function normalizeProvider(provider) {
  return Object.values(PROVIDERS).includes(provider) ? provider : PROVIDERS.OPENAI_COMPATIBLE;
}

function getProviderStatuses(settings = {}, env = process.env) {
  const selected = normalizeProvider(settings.provider);
  const statuses = PROVIDER_ORDER.map((provider) => {
    const defaults = getProviderDefaults(provider);
    const configuredKeyAvailable = Boolean(getStoredApiKey(provider, settings));
    const envKey = getEnvKey(provider, env);
    return {
      ...defaults,
      selected: selected === provider,
      keyAvailable: configuredKeyAvailable || Boolean(envKey),
      keySource: configuredKeyAvailable ? "settings" : envKey || "",
      usesStoredKey: configuredKeyAvailable
    };
  });
  return {
    selected,
    auto: {
      provider: chooseConfiguredProvider({ ...settings, provider: PROVIDERS.AUTO }, env)
    },
    providers: statuses
  };
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
  return generateWithOpenAIStyleProvider({ provider, input, context, skills, variantIndex, settings, fetchImpl });
}

async function generateWithAgnes({ input, context, skills, variantIndex, settings = {}, fetchImpl }) {
  const provider = PROVIDERS.AGNES;
  return generateWithOpenAIStyleProvider({ provider, input, context, skills, variantIndex, settings, fetchImpl });
}

async function generateWithOpenAIStyleProvider({ provider, input, context, skills, variantIndex, settings = {}, fetchImpl }) {
  const defaults = getProviderDefaults(provider);
  const effectiveSettings = {
    ...settings,
    baseUrl: settings.baseUrl || defaults.baseUrl,
    model: settings.model || defaults.model
  };
  const apiKey = getApiKey(provider, effectiveSettings);
  const request = createOpenAIChatRequest({ input, context, skills, variantIndex, settings: effectiveSettings });
  if (!apiKey) {
    const label = defaults.label;
    const error = new Error(`Missing API key for ${label} generation.`);
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

function chooseConfiguredProvider(settings = {}, env = process.env) {
  const provider = normalizeProvider(settings.provider);
  if (provider !== PROVIDERS.AUTO) return provider;
  const statuses = PROVIDER_ORDER.map((item) => ({
    provider: item,
    envKey: getEnvKey(item, env),
    settingsKey: Boolean(getStoredApiKey(item, settings))
  }));
  return statuses.find((status) => status.envKey || status.settingsKey)?.provider || PROVIDERS.OPENAI_COMPATIBLE;
}

function getConfiguredProviderOrder(settings = {}, env = process.env) {
  const provider = normalizeProvider(settings.provider);
  if (provider !== PROVIDERS.AUTO) return [provider];
  const configured = PROVIDER_ORDER.filter((item) => Boolean(getApiKey(item, settings, env)));
  return configured.length ? configured : [PROVIDERS.OPENAI_COMPATIBLE];
}

function createProviderSettings(settings = {}, provider, requestedProvider) {
  const defaults = getProviderDefaults(provider);
  return {
    ...(settings || {}),
    ...(requestedProvider === PROVIDERS.AUTO ? {
      baseUrl: defaults.baseUrl,
      model: defaults.model
    } : {}),
    provider,
    apiKey: requestedProvider === PROVIDERS.AUTO && provider !== PROVIDERS.OPENAI_COMPATIBLE
      && !settings?.providerKeys?.[provider]
      ? ""
      : settings?.apiKey
  };
}

async function generateWithProvider(provider, args, requestedProvider) {
  const settings = createProviderSettings(args.settings, provider, requestedProvider);
  const nextArgs = { ...args, settings };
  if (provider === PROVIDERS.AGNES) return generateWithAgnes(nextArgs);
  if (provider === PROVIDERS.ANTHROPIC) return generateWithAnthropic(nextArgs);
  if (provider === PROVIDERS.GEMINI) return generateWithGemini(nextArgs);
  return generateWithOpenAICompatible(nextArgs);
}

async function generateWithConfiguredProvider(args) {
  const requestedProvider = normalizeProvider(args.settings?.provider);
  const providers = getConfiguredProviderOrder(args.settings);
  const attempts = [];
  for (const provider of providers) {
    try {
      return await generateWithProvider(provider, args, requestedProvider);
    } catch (error) {
      attempts.push({
        provider,
        code: error.code || "unknown",
        status: error.status || null,
        message: error.message
      });
      if (provider === providers[providers.length - 1]) {
        error.attempts = attempts;
        throw error;
      }
    }
  }
}

module.exports = {
  PROVIDERS,
  PROVIDER_ORDER,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_AGNES_BASE_URL,
  DEFAULT_AGNES_MODEL,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  createAnthropicMessagesRequest,
  createGeminiGenerateContentRequest,
  createOpenAIChatRequest,
  chooseConfiguredProvider,
  generateWithAgnes,
  generateWithAnthropic,
  generateWithConfiguredProvider,
  generateWithGemini,
  generateWithOpenAICompatible,
  getConfiguredProviderOrder,
  getProviderDefaults,
  getProviderStatuses,
  getStoredApiKey,
  redactKey
};
