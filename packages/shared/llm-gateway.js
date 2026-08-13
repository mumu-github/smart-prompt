const { buildLlmMessages } = require("./smart-prompt-core");
const { parseStructuredLlmResponse, scorePromptQuality } = require("./prompt-quality");

const PROVIDERS = Object.freeze({
  AUTO: "auto",
  AGNES: "agnes",
  OPENAI_COMPATIBLE: "openai-compatible",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini",
  CUSTOM: "custom"
});

const CUSTOM_PROVIDER_PROTOCOLS = Object.freeze([
  PROVIDERS.OPENAI_COMPATIBLE,
  PROVIDERS.ANTHROPIC,
  PROVIDERS.GEMINI
]);

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
const MODEL_ID_MAX_LENGTH = 200;
const CUSTOM_PROVIDER_NAME_MAX_LENGTH = 80;

function modelValidationError() {
  const error = new Error("Model ID is required and cannot contain whitespace.");
  error.code = "model_invalid";
  error.status = 400;
  return error;
}

function normalizeModelId(value) {
  const model = String(value || "").trim();
  if (!model || model.length > MODEL_ID_MAX_LENGTH || /\s/.test(model)) throw modelValidationError();
  return model;
}

function providerSettingsValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function normalizeCustomProviderName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > CUSTOM_PROVIDER_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw providerSettingsValidationError(
      "custom_provider_name_invalid",
      "Custom provider name is required and must be 80 characters or fewer."
    );
  }
  return name;
}

function normalizeCustomProviderProtocol(value) {
  const protocol = String(value || PROVIDERS.OPENAI_COMPATIBLE).trim().toLowerCase();
  if (!CUSTOM_PROVIDER_PROTOCOLS.includes(protocol)) {
    throw providerSettingsValidationError(
      "custom_provider_protocol_invalid",
      "Custom provider protocol is not supported."
    );
  }
  return protocol;
}

function normalizeProviderBaseUrl(value) {
  const baseUrl = String(value || "").trim();
  try {
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid");
  } catch {
    throw providerSettingsValidationError(
      "custom_provider_base_url_invalid",
      "Custom provider Base URL must be a valid HTTP or HTTPS URL without embedded credentials."
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

function normalizeCustomProviderSettings(settings = {}) {
  const source = settings.customProvider && typeof settings.customProvider === "object"
    ? settings.customProvider
    : {};
  return {
    name: normalizeCustomProviderName(source.name ?? settings.customProviderName),
    protocol: normalizeCustomProviderProtocol(source.protocol ?? settings.customProviderProtocol),
    baseUrl: normalizeProviderBaseUrl(source.baseUrl ?? settings.baseUrl),
    model: normalizeModelId(source.model ?? settings.model)
  };
}

function redactKey(value) {
  if (!value) return "";
  return "configured";
}

function createOpenAIChatRequest({ input, context, skills, variantIndex, settings }) {
  const { card, messages } = buildLlmMessages(input, context, skills, variantIndex);
  const model = normalizeModelId(settings?.model || DEFAULT_MODEL);
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
  const model = normalizeModelId(settings?.model || DEFAULT_ANTHROPIC_MODEL);
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
  const model = normalizeModelId(settings?.model || DEFAULT_GEMINI_MODEL);
  const modelPath = String(model).startsWith("models/") ? model : `models/${model}`;
  const prompt = messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
  return {
    card,
    model,
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

function getProviderDefaults(provider, settings = {}) {
  if (provider === PROVIDERS.CUSTOM) {
    const custom = settings.customProvider && typeof settings.customProvider === "object"
      ? settings.customProvider
      : {};
    return {
      provider,
      label: String(custom.name || "Custom Provider"),
      baseUrl: String(custom.baseUrl || settings.baseUrl || ""),
      model: String(custom.model || settings.model || ""),
      envKeys: []
    };
  }
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
  const statuses = [...PROVIDER_ORDER, PROVIDERS.CUSTOM].map((provider) => {
    const defaults = getProviderDefaults(provider, settings);
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

function finiteToken(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function estimateTextTokenCount(text) {
  const value = String(text || "");
  if (!value) return 0;
  const latinLength = (value.match(/[\x00-\x7F]/g) || []).length;
  const nonLatinLength = value.length - latinLength;
  return Math.max(1, Math.ceil(latinLength / 4 + nonLatinLength / 1.5));
}

function normalizeProviderTokenUsage(data = {}) {
  const usage = data.usage || data.usageMetadata || {};
  const inputTokens = finiteToken(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount
  );
  const outputTokens = finiteToken(
    usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount
  );
  const cachedTokens = finiteToken(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.cache_read_input_tokens
      ?? usage.cachedContentTokenCount
  );
  const reasoningTokens = finiteToken(
    usage.completion_tokens_details?.reasoning_tokens
      ?? usage.thoughtsTokenCount
  );
  const available = [inputTokens, outputTokens, cachedTokens, reasoningTokens]
    .some((value) => value !== null);
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    source: available ? "provider" : "unavailable"
  };
}

function finishCard(request, rawResponse, tokenUsage = normalizeProviderTokenUsage()) {
  if (!rawResponse) {
    const error = new Error("LLM response did not contain prompt text.");
    error.code = "empty_llm_response";
    throw error;
  }
  const structuredOutput = parseStructuredLlmResponse(rawResponse, request.card);
  const prompt = structuredOutput.finalPrompt;
  const contextMessage = request.body.messages?.find((message) => String(message.content || "").includes("Context summary"));
  const contextText = contextMessage?.content || request.body.messages?.[0]?.content || request.body.contents?.[0]?.parts?.[0]?.text || "";
  const quality = scorePromptQuality(prompt, {
    mode: request.card.mode,
    skills: request.card.skills
  });
  const resolvedTokenUsage = tokenUsage.source === "provider"
    ? tokenUsage
    : {
        inputTokens: estimateTextTokenCount(JSON.stringify(request.body || {})),
        outputTokens: estimateTextTokenCount(rawResponse),
        cachedTokens: null,
        reasoningTokens: null,
        source: "estimated"
      };
  return {
    ...request.card,
    prompt,
    structuredOutput,
    quality,
    generatedBy: "llm",
    model: request.model || request.body.model || request.endpoint.match(/\/models\/([^:/]+)/)?.[1] || "",
    contextSummary: contextText.split("\n")[0] || "",
    tokenUsage: resolvedTokenUsage
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
  const defaults = getProviderDefaults(provider, settings);
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
  const card = finishCard(request, prompt, normalizeProviderTokenUsage(data));
  return { ...card, provider };
}

async function generateWithAnthropicStyleProvider({ provider, input, context, skills, variantIndex, settings = {}, fetchImpl }) {
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
  const card = finishCard(request, extractAnthropicText(data), normalizeProviderTokenUsage(data));
  return { ...card, provider };
}

async function generateWithAnthropic(args) {
  return generateWithAnthropicStyleProvider({ ...args, provider: PROVIDERS.ANTHROPIC });
}

async function generateWithGeminiStyleProvider({ provider, input, context, skills, variantIndex, settings = {}, fetchImpl }) {
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
  const card = finishCard(request, extractGeminiText(data), normalizeProviderTokenUsage(data));
  return { ...card, provider };
}

async function generateWithGemini(args) {
  return generateWithGeminiStyleProvider({ ...args, provider: PROVIDERS.GEMINI });
}

async function generateWithCustomProvider(args) {
  const customProvider = normalizeCustomProviderSettings(args.settings);
  const settings = {
    ...args.settings,
    provider: PROVIDERS.CUSTOM,
    baseUrl: customProvider.baseUrl,
    model: customProvider.model,
    customProvider
  };
  const nextArgs = { ...args, settings, provider: PROVIDERS.CUSTOM };
  if (customProvider.protocol === PROVIDERS.ANTHROPIC) {
    return generateWithAnthropicStyleProvider(nextArgs);
  }
  if (customProvider.protocol === PROVIDERS.GEMINI) {
    return generateWithGeminiStyleProvider(nextArgs);
  }
  return generateWithOpenAIStyleProvider(nextArgs);
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
  if (provider === PROVIDERS.CUSTOM) return generateWithCustomProvider(nextArgs);
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
  CUSTOM_PROVIDER_NAME_MAX_LENGTH,
  CUSTOM_PROVIDER_PROTOCOLS,
  MODEL_ID_MAX_LENGTH,
  createAnthropicMessagesRequest,
  createGeminiGenerateContentRequest,
  createOpenAIChatRequest,
  chooseConfiguredProvider,
  generateWithAgnes,
  generateWithAnthropic,
  generateWithConfiguredProvider,
  generateWithCustomProvider,
  generateWithGemini,
  generateWithOpenAICompatible,
  getConfiguredProviderOrder,
  getProviderDefaults,
  getProviderStatuses,
  getStoredApiKey,
  normalizeCustomProviderName,
  normalizeCustomProviderProtocol,
  normalizeCustomProviderSettings,
  estimateTextTokenCount,
  normalizeModelId,
  normalizeProviderBaseUrl,
  normalizeProviderTokenUsage,
  redactKey
};
