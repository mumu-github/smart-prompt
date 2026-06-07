const SERVICE_URL = "http://127.0.0.1:17371";
let serviceAuthToken = "";

const PROVIDER_DEFAULTS = {
  auto: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  agnes: {
    baseUrl: "https://apihub.agnes-ai.com/v1",
    model: "agnes-2.0-flash"
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514"
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash"
  }
};

const els = {
  status: document.getElementById("service-status"),
  provider: document.getElementById("provider"),
  providerStatus: document.getElementById("provider-status"),
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("api-key"),
  agnesApiKey: document.getElementById("agnes-api-key"),
  openaiApiKey: document.getElementById("openai-api-key"),
  anthropicApiKey: document.getElementById("anthropic-api-key"),
  geminiApiKey: document.getElementById("gemini-api-key"),
  startService: document.getElementById("start-service"),
  stopService: document.getElementById("stop-service"),
  firstRunProgress: document.getElementById("first-run-progress"),
  privacyBoundary: document.getElementById("privacy-boundary"),
  testProvider: document.getElementById("test-provider"),
  providerTestStatus: document.getElementById("provider-test-status"),
  saveSettings: document.getElementById("save-settings"),
  skillFolder: document.getElementById("skill-folder"),
  importFolder: document.getElementById("import-folder"),
  skillList: document.getElementById("skill-list"),
  promptTitle: document.getElementById("prompt-title"),
  promptBody: document.getElementById("prompt-body"),
  savePrompt: document.getElementById("save-prompt"),
  promptList: document.getElementById("prompt-list"),
  shortcut: document.getElementById("shortcut"),
  saveShortcut: document.getElementById("save-shortcut")
};

const firstRunState = {
  settings: null,
  providerStatus: null,
  skills: []
};

async function serviceRequest(path, options, retrying = false) {
  const token = await getServiceAuthToken(path);
  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {})
    }
  });
  const body = await response.json();
  if (response.status === 401 && path !== "/auth/bootstrap" && !retrying) {
    serviceAuthToken = "";
    return serviceRequest(path, options, true);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body?.error?.message || `Service failed: ${response.status}`);
  }
  return body;
}

async function getServiceAuthToken(path) {
  if (path === "/health" || path === "/auth/bootstrap") return "";
  if (serviceAuthToken) return serviceAuthToken;
  const response = await fetch(`${SERVICE_URL}/auth/bootstrap`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false || !body.auth?.token) {
    throw new Error(body?.error?.message || `Service auth failed: ${response.status}`);
  }
  serviceAuthToken = body.auth.token;
  return serviceAuthToken;
}

function setStatus(text, ok) {
  els.status.textContent = text;
  els.status.classList.toggle("is-online", Boolean(ok));
  els.status.classList.toggle("is-offline", !ok);
}

async function refreshLocalServiceStatus() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("get_local_service_status");
    document.documentElement.dataset.localServiceStatus = status;
    if (status === "running") setStatus("service process running", true);
    if (status === "stopped") setStatus("service process stopped", false);
    if (status.startsWith("exited:")) setStatus(`service ${status}`, false);
    return status;
  }
  return "";
}

function recordShortcutTrigger(shortcut) {
  window.__smartPromptShortcutHits = (window.__smartPromptShortcutHits || 0) + 1;
  document.documentElement.dataset.shortcutHits = String(window.__smartPromptShortcutHits);
  document.documentElement.dataset.lastShortcut = shortcut || "";
  setStatus(`shortcut triggered: ${shortcut || "unknown"}`, true);
}

function renderSkills(skills) {
  if (!skills?.length) {
    els.skillList.innerHTML = '<div class="skill-row">No imported skills yet.</div>';
    return;
  }
  els.skillList.innerHTML = skills.slice(0, 20).map((skill) => {
    const id = encodeURIComponent(skill.id || "");
    return `<div class="skill-row library-row"><div><strong>${escapeHtml(skill.name)}</strong><br>${escapeHtml(skill.description || "")}</div><button type="button" class="row-action" data-action="delete-skill" data-skill-id="${id}">Delete</button></div>`;
  }).join("");
}

function renderPrompts(prompts) {
  if (!prompts?.length) {
    els.promptList.innerHTML = '<div class="skill-row">No saved prompts yet.</div>';
    return;
  }
  els.promptList.innerHTML = prompts.slice(0, 20).map((prompt) => {
    const body = String(prompt.body || "").slice(0, 180);
    const id = encodeURIComponent(prompt.id || "");
    return `<div class="skill-row library-row"><div><strong>${escapeHtml(prompt.title)}</strong><br>${escapeHtml(body)}</div><button type="button" class="row-action" data-action="delete-prompt" data-prompt-id="${id}">Delete</button></div>`;
  }).join("");
}

function renderProviderStatus(status) {
  if (!status?.providers) {
    els.providerStatus.textContent = "Provider status unavailable.";
    return;
  }
  const ready = status.providers
    .filter((provider) => provider.keyAvailable)
    .map((provider) => provider.label)
    .join(", ") || "none";
  els.providerStatus.textContent = `Selected: ${status.selected}; auto: ${status.auto?.provider || "n/a"}; ready: ${ready}`;
}

function renderFirstRunProgress(nextState = {}) {
  firstRunState.settings = nextState.settings || firstRunState.settings;
  firstRunState.providerStatus = nextState.providerStatus || firstRunState.providerStatus;
  firstRunState.skills = Array.isArray(nextState.skills) ? nextState.skills : firstRunState.skills;

  const settings = firstRunState.settings || {};
  const providerStatus = firstRunState.providerStatus || {};
  const providerConfigured = Boolean(settings.provider && settings.model);
  const providerKeyReady = Boolean(providerStatus.providers?.some((provider) => provider.keyAvailable));
  const providerTested = localStorage.getItem("smartPromptProviderTestPass") === "true";
  const skillImported = firstRunState.skills.length > 0;
  const privacyVisible = Boolean(els.privacyBoundary);
  const steps = [
    ["provider", providerConfigured],
    ["key", providerKeyReady],
    ["test", providerTested],
    ["skill", skillImported],
    ["privacy", privacyVisible]
  ];
  const readyCount = steps.filter(([, ready]) => ready).length;
  const missing = steps.filter(([, ready]) => !ready).map(([label]) => label).join(", ") || "complete";

  els.firstRunProgress.textContent = `${readyCount}/${steps.length} ready; missing: ${missing}`;
  els.firstRunProgress.dataset.providerConfigured = String(providerConfigured);
  els.firstRunProgress.dataset.providerKeyReady = String(providerKeyReady);
  els.firstRunProgress.dataset.providerTested = String(providerTested);
  els.firstRunProgress.dataset.skillImported = String(skillImported);
  els.firstRunProgress.dataset.privacyVisible = String(privacyVisible);
  els.firstRunProgress.dataset.firstRunReady = String(readyCount === steps.length);
}

function setKeyPlaceholder(element, redacted, label) {
  element.value = "";
  element.placeholder = redacted ? `Stored ${redacted}` : label;
}

function collectProviderKeys() {
  const providerKeys = {};
  if (els.agnesApiKey.value) providerKeys.agnes = els.agnesApiKey.value;
  if (els.openaiApiKey.value) providerKeys["openai-compatible"] = els.openaiApiKey.value;
  if (els.anthropicApiKey.value) providerKeys.anthropic = els.anthropicApiKey.value;
  if (els.geminiApiKey.value) providerKeys.gemini = els.geminiApiKey.value;
  return providerKeys;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyProviderDefaults() {
  const defaults = PROVIDER_DEFAULTS[els.provider.value] || PROVIDER_DEFAULTS["openai-compatible"];
  els.baseUrl.value = defaults.baseUrl;
  els.model.value = defaults.model;
}

async function loadServiceState() {
  try {
    await serviceRequest("/health", { method: "GET" });
    const settings = await serviceRequest("/settings", { method: "GET" });
    const providerStatus = await serviceRequest("/llm/providers", { method: "GET" });
    const skills = await serviceRequest("/skills", { method: "GET" });
    const prompts = await serviceRequest("/prompts", { method: "GET" });
    els.provider.value = settings.settings.provider || els.provider.value;
    els.baseUrl.value = settings.settings.baseUrl || els.baseUrl.value;
    els.model.value = settings.settings.model || els.model.value;
    setKeyPlaceholder(els.apiKey, settings.settings.apiKey, "Stored by local service");
    setKeyPlaceholder(els.agnesApiKey, settings.settings.providerKeys?.agnes, "Agnes API key");
    setKeyPlaceholder(els.openaiApiKey, settings.settings.providerKeys?.["openai-compatible"], "OpenAI-compatible API key");
    setKeyPlaceholder(els.anthropicApiKey, settings.settings.providerKeys?.anthropic, "Anthropic API key");
    setKeyPlaceholder(els.geminiApiKey, settings.settings.providerKeys?.gemini, "Gemini API key");
    renderSkills(skills.skills);
    renderPrompts(prompts.prompts);
    renderProviderStatus(providerStatus);
    renderFirstRunProgress({ settings: settings.settings, providerStatus, skills: skills.skills });
    setStatus("service online", true);
  } catch {
    setStatus("service offline", false);
  }
}

async function saveSettings() {
  localStorage.setItem("smartPromptProviderTestPass", "false");
  const providerKeys = collectProviderKeys();
  const payload = {
    provider: els.provider.value,
    baseUrl: els.baseUrl.value,
    model: els.model.value
  };
  if (els.apiKey.value) payload.apiKey = els.apiKey.value;
  if (Object.keys(providerKeys).length) payload.providerKeys = providerKeys;
  await serviceRequest("/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  els.apiKey.value = "";
  els.agnesApiKey.value = "";
  els.openaiApiKey.value = "";
  els.anthropicApiKey.value = "";
  els.geminiApiKey.value = "";
  await loadServiceState();
}

async function testProvider() {
  els.providerTestStatus.textContent = "testing provider";
  els.providerTestStatus.dataset.providerTestPass = "pending";
  try {
    const result = await serviceRequest("/llm/test", {
      method: "POST",
      body: JSON.stringify({ mode: "idea" })
    });
    localStorage.setItem("smartPromptProviderTestPass", "true");
    localStorage.setItem("smartPromptProviderTestedAt", result.testedAt || new Date().toISOString());
    els.providerTestStatus.textContent = `${result.provider || els.provider.value} ${result.model || els.model.value} ready (${result.generatedBy}, ${result.promptLength} chars)`;
    els.providerTestStatus.dataset.providerTestPass = "true";
    els.providerTestStatus.dataset.promptLength = String(result.promptLength || 0);
    const providerStatus = await serviceRequest("/llm/providers", { method: "GET" });
    renderProviderStatus(providerStatus);
    renderFirstRunProgress({ providerStatus });
  } catch (error) {
    localStorage.setItem("smartPromptProviderTestPass", "false");
    els.providerTestStatus.textContent = `provider test failed: ${error.message}`;
    els.providerTestStatus.dataset.providerTestPass = "false";
    renderFirstRunProgress();
    throw error;
  }
}

async function importFolder() {
  const result = await serviceRequest("/skills/import-folder", {
    method: "POST",
    body: JSON.stringify({ path: els.skillFolder.value })
  });
  renderSkills(result.skills);
  renderFirstRunProgress({ skills: result.skills });
}

async function deleteSkill(id) {
  if (!id) return;
  const result = await serviceRequest(`/skills/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  renderSkills(result.skills);
  renderFirstRunProgress({ skills: result.skills });
}

async function savePrompt() {
  const result = await serviceRequest("/prompts", {
    method: "POST",
    body: JSON.stringify({
      title: els.promptTitle.value,
      body: els.promptBody.value,
      source: "desktop-shell"
    })
  });
  els.promptTitle.value = "";
  els.promptBody.value = "";
  renderPrompts(result.prompts);
}

async function deletePrompt(id) {
  if (!id) return;
  const result = await serviceRequest(`/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  renderPrompts(result.prompts);
}

function handleSkillListAction(event) {
  const button = event.target.closest('button[data-action="delete-skill"]');
  if (!button) return;
  deleteSkill(decodeURIComponent(button.dataset.skillId || "")).catch((error) => setStatus(error.message, false));
}

function handlePromptListAction(event) {
  const button = event.target.closest('button[data-action="delete-prompt"]');
  if (!button) return;
  deletePrompt(decodeURIComponent(button.dataset.promptId || "")).catch((error) => setStatus(error.message, false));
}

async function saveShortcut() {
  if (window.__TAURI__?.core?.invoke) {
    await window.__TAURI__.core.invoke("set_global_shortcut", { shortcut: els.shortcut.value });
  }
  localStorage.setItem("smartPromptShortcut", els.shortcut.value);
}

async function bindTauriEvents() {
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen("smart-prompt-shortcut", (event) => {
      recordShortcutTrigger(event.payload);
    }).catch((error) => setStatus(error.message, false));
  }
  window.__smartPromptEventsReady = true;
}

async function startLocalService() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("start_local_service");
    document.documentElement.dataset.localServiceStatus = status;
    await loadServiceState();
    return;
  }
  setStatus("run local service manually", false);
}

async function stopLocalService() {
  if (window.__TAURI__?.core?.invoke) {
    const status = await window.__TAURI__.core.invoke("stop_local_service");
    document.documentElement.dataset.localServiceStatus = status;
    setStatus("service process stopped", false);
    return;
  }
  setStatus("stop local service from terminal", false);
}

els.saveSettings.addEventListener("click", () => saveSettings().catch((error) => setStatus(error.message, false)));
els.startService.addEventListener("click", () => startLocalService().catch((error) => setStatus(error.message, false)));
els.stopService.addEventListener("click", () => stopLocalService().catch((error) => setStatus(error.message, false)));
els.testProvider.addEventListener("click", () => testProvider().catch((error) => setStatus(error.message, false)));
els.importFolder.addEventListener("click", () => importFolder().catch((error) => setStatus(error.message, false)));
els.savePrompt.addEventListener("click", () => savePrompt().catch((error) => setStatus(error.message, false)));
els.skillList.addEventListener("click", handleSkillListAction);
els.promptList.addEventListener("click", handlePromptListAction);
els.provider.addEventListener("change", applyProviderDefaults);
els.saveShortcut.addEventListener("click", () => saveShortcut().catch((error) => setStatus(error.message, false)));
els.shortcut.value = localStorage.getItem("smartPromptShortcut") || els.shortcut.value;
window.__smartPromptShortcutHits = 0;
window.__smartPromptEventsReady = false;
bindTauriEvents().catch((error) => setStatus(error.message, false));
refreshLocalServiceStatus().catch(() => {});
loadServiceState();
