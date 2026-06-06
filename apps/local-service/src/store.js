const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 17371;
const DEFAULT_SETTINGS = Object.freeze({
  provider: "auto",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.35,
  apiKey: "",
  providerKeys: {
    "openai-compatible": "",
    anthropic: "",
    gemini: ""
  },
  uploadWholePage: false,
  autoSubmit: false
});

function defaultDataDir() {
  return process.env.SMART_PROMPT_DATA_DIR || path.join(__dirname, "..", ".smart-prompt-data");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeProvider(value, fallback = "auto") {
  return ["auto", "openai-compatible", "anthropic", "gemini"].includes(value) ? value : fallback;
}

function normalizeProviderKeys(current, incoming, provider, legacyApiKey) {
  const merged = {
    ...DEFAULT_SETTINGS.providerKeys,
    ...(current?.providerKeys || {})
  };
  const currentProvider = normalizeProvider(current?.provider, "openai-compatible");
  if (current?.apiKey) {
    const legacyProvider = currentProvider === "auto" ? "openai-compatible" : currentProvider;
    if (!merged[legacyProvider]) merged[legacyProvider] = current.apiKey;
  }
  if (incoming && typeof incoming === "object") {
    for (const key of Object.keys(DEFAULT_SETTINGS.providerKeys)) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        merged[key] = String(incoming[key] || "");
      }
    }
  }
  if (legacyApiKey) {
    const targetProvider = provider === "auto" ? "openai-compatible" : provider;
    merged[targetProvider] = String(legacyApiKey);
  }
  return merged;
}

function createStore(dataDir = defaultDataDir()) {
  ensureDir(dataDir);
  const settingsFile = path.join(dataDir, "settings.json");
  const skillsFile = path.join(dataDir, "skills.json");
  const promptsFile = path.join(dataDir, "prompts.json");
  const historyFile = path.join(dataDir, "prompt-history.json");

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) };
  }

  function saveSettings(next) {
    const current = getSettings();
    const provider = normalizeProvider(next?.provider, current.provider);
    const safe = {
      ...current,
      ...next,
      provider,
      apiKey: "",
      providerKeys: normalizeProviderKeys(current, next?.providerKeys, provider, next?.apiKey),
      uploadWholePage: false,
      autoSubmit: false
    };
    writeJson(settingsFile, safe);
    return safe;
  }

  function getSkills() {
    return readJson(skillsFile, []);
  }

  function saveSkills(skills) {
    writeJson(skillsFile, Array.isArray(skills) ? skills : []);
    return getSkills();
  }

  function addSkills(skills) {
    const merged = [...skills, ...getSkills()].filter((skill, index, all) => {
      return all.findIndex((item) => item.id === skill.id) === index;
    });
    return saveSkills(merged);
  }

  function getPrompts() {
    return readJson(promptsFile, []);
  }

  function savePrompts(prompts) {
    writeJson(promptsFile, Array.isArray(prompts) ? prompts : []);
    return getPrompts();
  }

  function addPrompt(prompt) {
    const now = new Date().toISOString();
    const safe = {
      id: prompt.id || `prompt-${Date.now()}`,
      title: String(prompt.title || "Untitled prompt").slice(0, 120),
      body: String(prompt.body || prompt.prompt || ""),
      mode: prompt.mode || "custom",
      tags: Array.isArray(prompt.tags) ? prompt.tags.slice(0, 12) : [],
      context: prompt.context || {},
      created_at: prompt.created_at || now,
      updated_at: now,
      source: prompt.source || "local-service"
    };
    const next = [safe, ...getPrompts().filter((item) => item.id !== safe.id)].slice(0, 200);
    return savePrompts(next);
  }

  function deletePrompt(id) {
    const before = getPrompts();
    const next = before.filter((prompt) => prompt.id !== id);
    savePrompts(next);
    return before.length !== next.length;
  }

  function addPromptHistory(entry) {
    const current = readJson(historyFile, []);
    const next = [entry, ...current].slice(0, 100);
    writeJson(historyFile, next);
    return next;
  }

  return {
    dataDir,
    getSettings,
    saveSettings,
    getSkills,
    saveSkills,
    addSkills,
    getPrompts,
    savePrompts,
    addPrompt,
    deletePrompt,
    addPromptHistory
  };
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  createStore,
  defaultDataDir
};
