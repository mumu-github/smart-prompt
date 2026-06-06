const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 17371;
const DEFAULT_SETTINGS = Object.freeze({
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.35,
  apiKey: "",
  uploadWholePage: false,
  autoSubmit: false
});

function defaultDataDir() {
  return process.env.SMART_PROMPT_DATA_DIR || path.join(process.cwd(), ".smart-prompt-data");
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

function createStore(dataDir = defaultDataDir()) {
  ensureDir(dataDir);
  const settingsFile = path.join(dataDir, "settings.json");
  const skillsFile = path.join(dataDir, "skills.json");
  const historyFile = path.join(dataDir, "prompt-history.json");

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) };
  }

  function saveSettings(next) {
    const current = getSettings();
    const safe = {
      ...current,
      ...next,
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
    addPromptHistory
  };
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  createStore,
  defaultDataDir
};
