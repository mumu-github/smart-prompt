const SERVICE_URL = "http://127.0.0.1:17371";

const els = {
  status: document.getElementById("service-status"),
  baseUrl: document.getElementById("base-url"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("api-key"),
  startService: document.getElementById("start-service"),
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

async function serviceRequest(path, options) {
  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body?.error?.message || `Service failed: ${response.status}`);
  }
  return body;
}

function setStatus(text, ok) {
  els.status.textContent = text;
  els.status.style.color = ok ? "#166d69" : "#8b312d";
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
    return `<div class="skill-row"><strong>${escapeHtml(skill.name)}</strong><br>${escapeHtml(skill.description || "")}</div>`;
  }).join("");
}

function renderPrompts(prompts) {
  if (!prompts?.length) {
    els.promptList.innerHTML = '<div class="skill-row">No saved prompts yet.</div>';
    return;
  }
  els.promptList.innerHTML = prompts.slice(0, 20).map((prompt) => {
    const body = String(prompt.body || "").slice(0, 180);
    return `<div class="skill-row"><strong>${escapeHtml(prompt.title)}</strong><br>${escapeHtml(body)}</div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadServiceState() {
  try {
    await serviceRequest("/health", { method: "GET" });
    const settings = await serviceRequest("/settings", { method: "GET" });
    const skills = await serviceRequest("/skills", { method: "GET" });
    const prompts = await serviceRequest("/prompts", { method: "GET" });
    els.baseUrl.value = settings.settings.baseUrl || els.baseUrl.value;
    els.model.value = settings.settings.model || els.model.value;
    renderSkills(skills.skills);
    renderPrompts(prompts.prompts);
    setStatus("service online", true);
  } catch {
    setStatus("service offline", false);
  }
}

async function saveSettings() {
  await serviceRequest("/settings", {
    method: "PUT",
    body: JSON.stringify({
      baseUrl: els.baseUrl.value,
      model: els.model.value,
      apiKey: els.apiKey.value
    })
  });
  els.apiKey.value = "";
  await loadServiceState();
}

async function importFolder() {
  const result = await serviceRequest("/skills/import-folder", {
    method: "POST",
    body: JSON.stringify({ path: els.skillFolder.value })
  });
  renderSkills(result.skills);
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
    await window.__TAURI__.core.invoke("start_local_service");
    await loadServiceState();
    return;
  }
  setStatus("run local service manually", false);
}

els.saveSettings.addEventListener("click", () => saveSettings().catch((error) => setStatus(error.message, false)));
els.startService.addEventListener("click", () => startLocalService().catch((error) => setStatus(error.message, false)));
els.importFolder.addEventListener("click", () => importFolder().catch((error) => setStatus(error.message, false)));
els.savePrompt.addEventListener("click", () => savePrompt().catch((error) => setStatus(error.message, false)));
els.saveShortcut.addEventListener("click", () => saveShortcut().catch((error) => setStatus(error.message, false)));
els.shortcut.value = localStorage.getItem("smartPromptShortcut") || els.shortcut.value;
window.__smartPromptShortcutHits = 0;
window.__smartPromptEventsReady = false;
bindTauriEvents().catch((error) => setStatus(error.message, false));
loadServiceState();
