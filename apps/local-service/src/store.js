const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCredentialVault } = require("./credential-vault");

const DEFAULT_PORT = 17371;
const DATA_SCHEMA_VERSION = 1;
const DEFAULT_SETTINGS = Object.freeze({
  provider: "auto",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.35,
  apiKey: "",
  providerKeys: {
    agnes: "",
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

function createAuthToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function matchesQuery(parts, query) {
  const needle = normalizeSearchText(query).trim();
  if (!needle) return true;
  return parts.map(normalizeSearchText).join(" ").includes(needle);
}

function normalizeProvider(value, fallback = "auto") {
  return ["auto", "agnes", "openai-compatible", "anthropic", "gemini"].includes(value) ? value : fallback;
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

function hasProviderKeys(settings = {}) {
  return Object.values(settings.providerKeys || {}).some(Boolean) || Boolean(settings.apiKey);
}

function emptyProviderKeys() {
  return { ...DEFAULT_SETTINGS.providerKeys };
}

function createStore(dataDir = defaultDataDir(), options = {}) {
  ensureDir(dataDir);
  const settingsFile = path.join(dataDir, "settings.json");
  const skillsFile = path.join(dataDir, "skills.json");
  const promptsFile = path.join(dataDir, "prompts.json");
  const historyFile = path.join(dataDir, "prompt-history.json");
  const metricsFile = path.join(dataDir, "metrics.json");
  const metadataFile = path.join(dataDir, "metadata.json");
  const securityFile = path.join(dataDir, "security.json");
  const credentialVault = options.credentialVault || createCredentialVault(dataDir);

  function getMetadata() {
    const metadata = readJson(metadataFile, {});
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      migrated_at: metadata.migrated_at || new Date().toISOString(),
      ...metadata
    };
  }

  function migrateData() {
    const metadata = getMetadata();
    if (metadata.schemaVersion !== DATA_SCHEMA_VERSION) {
      metadata.schemaVersion = DATA_SCHEMA_VERSION;
      metadata.migrated_at = new Date().toISOString();
    }
    writeJson(metadataFile, metadata);
    return metadata;
  }

  function readSettingsFile() {
    return { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) };
  }

  function sanitizeSettingsFile(settings) {
    return {
      ...settings,
      apiKey: "",
      providerKeys: emptyProviderKeys(),
      uploadWholePage: false,
      autoSubmit: false
    };
  }

  function migrateProviderKeysIfNeeded(persisted, encryptedProviderKeys) {
    if (!hasProviderKeys(persisted)) return null;
    const provider = normalizeProvider(persisted.provider, "openai-compatible");
    const migrated = normalizeProviderKeys({
      provider: persisted.provider,
      apiKey: persisted.apiKey,
      providerKeys: encryptedProviderKeys
    }, persisted.providerKeys, provider, persisted.apiKey);
    credentialVault.saveProviderKeys(migrated);
    writeJson(settingsFile, sanitizeSettingsFile(persisted));
    writeJson(path.join(dataDir, "key-migration.json"), {
      migrateProviderKeys: true,
      migratedAt: new Date().toISOString(),
      storage: credentialVault.getStorageSummary().storage
    });
    return migrated;
  }

  function getSettings() {
    const persisted = readSettingsFile();
    const encryptedProviderKeys = {
      ...DEFAULT_SETTINGS.providerKeys,
      ...credentialVault.loadProviderKeys()
    };
    const migrated = migrateProviderKeysIfNeeded(persisted, encryptedProviderKeys);
    if (migrated) {
      return {
        ...sanitizeSettingsFile(persisted),
        providerKeys: {
          ...DEFAULT_SETTINGS.providerKeys,
          ...migrated
        },
        credentialStorage: credentialVault.getStorageSummary()
      };
    }
    return {
      ...persisted,
      apiKey: "",
      providerKeys: encryptedProviderKeys,
      uploadWholePage: false,
      autoSubmit: false,
      credentialStorage: credentialVault.getStorageSummary()
    };
  }

  function saveSettings(next) {
    const current = getSettings();
    const provider = normalizeProvider(next?.provider, current.provider);
    const providerKeys = normalizeProviderKeys(current, next?.providerKeys, provider, next?.apiKey);
    credentialVault.saveProviderKeys(providerKeys);
    const safe = {
      ...current,
      ...next,
      provider,
      apiKey: "",
      providerKeys: emptyProviderKeys(),
      uploadWholePage: false,
      autoSubmit: false,
      credentialStorage: credentialVault.getStorageSummary()
    };
    writeJson(settingsFile, safe);
    return getSettings();
  }

  function getSecurity() {
    const envToken = process.env.SMART_PROMPT_AUTH_TOKEN;
    if (envToken) {
      return {
        ...readJson(securityFile, {}),
        authToken: String(envToken)
      };
    }

    const current = readJson(securityFile, {});
    if (current.authToken) return current;

    const next = {
      authToken: createAuthToken(),
      created_at: new Date().toISOString()
    };
    writeJson(securityFile, next);
    return next;
  }

  function getAuthToken() {
    return getSecurity().authToken;
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

  function deleteSkill(id) {
    const before = getSkills();
    const next = before.filter((skill) => skill.id !== id);
    saveSkills(next);
    return before.length !== next.length;
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
    const body = String(prompt.body || prompt.prompt || "");
    const bodyHash = prompt.bodyHash || hashText(body);
    const existing = getPrompts().find((item) => item.bodyHash === bodyHash);
    const safe = {
      id: prompt.id || existing?.id || `prompt-${Date.now()}`,
      title: String(prompt.title || "Untitled prompt").slice(0, 120),
      body,
      bodyHash,
      mode: prompt.mode || "custom",
      tags: Array.isArray(prompt.tags) ? prompt.tags.slice(0, 12) : [],
      context: prompt.context || {},
      created_at: prompt.created_at || existing?.created_at || now,
      updated_at: now,
      source: prompt.source || "local-service"
    };
    const next = [safe, ...getPrompts().filter((item) => item.id !== safe.id && item.bodyHash !== bodyHash)].slice(0, 200);
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
    const next = [{
      id: entry.id || `history-${Date.now()}`,
      created_at: entry.created_at || new Date().toISOString(),
      mode: entry.mode || "",
      tool: entry.tool || "",
      generatedBy: entry.generatedBy || "",
      context: entry.context || {}
    }, ...current].slice(0, 100);
    writeJson(historyFile, next);
    return next;
  }

  function getPromptHistory() {
    return readJson(historyFile, []);
  }

  function searchPrompts(query) {
    return getPrompts().filter((prompt) => matchesQuery([
      prompt.title,
      prompt.body,
      prompt.mode,
      prompt.source,
      ...(prompt.tags || [])
    ], query));
  }

  function searchSkills(query) {
    return getSkills().filter((skill) => matchesQuery([
      skill.name,
      skill.description,
      skill.id,
      ...(skill.tags || [])
    ], query));
  }

  function recordMetric(event = {}) {
    const current = readJson(metricsFile, []);
    const safe = {
      id: event.id || `metric-${Date.now()}`,
      created_at: event.created_at || new Date().toISOString(),
      action: String(event.action || "unknown").slice(0, 40),
      mode: String(event.mode || "").slice(0, 40),
      tool: String(event.tool || "").slice(0, 80),
      generatedBy: String(event.generatedBy || "").slice(0, 40),
      ok: Boolean(event.ok),
      adopted: Boolean(event.adopted),
      promptLength: Number(event.promptLength || 0)
    };
    const next = [safe, ...current].slice(0, 500);
    writeJson(metricsFile, next);
    return next;
  }

  function getMetrics() {
    const events = readJson(metricsFile, []);
    const byAction = {};
    for (const event of events) {
      byAction[event.action] = (byAction[event.action] || 0) + 1;
    }
    const insertEvents = events.filter((event) => event.action === "insert");
    const adoptedInsertEvents = insertEvents.filter((event) => event.adopted);
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      eventCount: events.length,
      byAction,
      insertSuccessRate: insertEvents.length ? adoptedInsertEvents.length / insertEvents.length : 0,
      savedPromptCount: getPrompts().length,
      skillCount: getSkills().length,
      promptHistoryCount: getPromptHistory().length,
      events
    };
  }

  function exportData() {
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      settings: sanitizeSettingsFile(readSettingsFile()),
      skills: getSkills(),
      prompts: getPrompts(),
      promptHistory: getPromptHistory(),
      metrics: readJson(metricsFile, [])
    };
  }

  function restoreData(bundle = {}) {
    if (Number(bundle.schemaVersion || 0) > DATA_SCHEMA_VERSION) {
      const error = new Error(`Unsupported data schema version: ${bundle.schemaVersion}`);
      error.code = "unsupported_schema_version";
      throw error;
    }
    if (Array.isArray(bundle.skills)) saveSkills(bundle.skills);
    if (Array.isArray(bundle.prompts)) savePrompts(bundle.prompts);
    if (Array.isArray(bundle.promptHistory)) writeJson(historyFile, bundle.promptHistory.slice(0, 100));
    if (Array.isArray(bundle.metrics)) writeJson(metricsFile, bundle.metrics.slice(0, 500));
    migrateData();
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      skills: getSkills().length,
      prompts: getPrompts().length,
      promptHistory: getPromptHistory().length,
      metrics: readJson(metricsFile, []).length
    };
  }

  function clearAllLocalData() {
    const deleted = [];
    for (const file of [
      settingsFile,
      skillsFile,
      promptsFile,
      historyFile,
      metricsFile,
      metadataFile,
      securityFile,
      path.join(dataDir, "provider-keys.json"),
      path.join(dataDir, "key-migration.json")
    ]) {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        deleted.push(path.basename(file));
      }
    }
    migrateData();
    getSecurity();
    return {
      clearAllLocalData: true,
      deleted,
      schemaVersion: DATA_SCHEMA_VERSION
    };
  }

  function exportDiagnostics() {
    const settings = getSettings();
    const metrics = getMetrics();
    return {
      createdAt: new Date().toISOString(),
      diagnostics: true,
      service: "smart-prompt-local-service",
      schemaVersion: DATA_SCHEMA_VERSION,
      dataDir,
      metadata: getMetadata(),
      counts: {
        skills: getSkills().length,
        prompts: getPrompts().length,
        promptHistory: getPromptHistory().length,
        metrics: metrics.eventCount
      },
      metrics,
      credentialStorage: settings.credentialStorage,
      keyMigration: readJson(path.join(dataDir, "key-migration.json"), {
        migrateProviderKeys: false
      }),
      portRecovery: {
        supported: true,
        portRecovery: true
      }
    };
  }

  migrateData();

  return {
    dataDir,
    schemaVersion: DATA_SCHEMA_VERSION,
    getMetadata,
    migrateData,
    getSettings,
    saveSettings,
    getAuthToken,
    getSecurity,
    getSkills,
    saveSkills,
    addSkills,
    deleteSkill,
    getPrompts,
    savePrompts,
    addPrompt,
    deletePrompt,
    addPromptHistory,
    getPromptHistory,
    searchPrompts,
    searchSkills,
    recordMetric,
    getMetrics,
    exportData,
    restoreData,
    clearAllLocalData,
    exportDiagnostics,
    migrateProviderKeysIfNeeded
  };
}

module.exports = {
  DATA_SCHEMA_VERSION,
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  createAuthToken,
  createStore,
  defaultDataDir
};
