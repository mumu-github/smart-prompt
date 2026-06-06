const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

const elementIds = [
  "service-status",
  "provider",
  "provider-status",
  "base-url",
  "model",
  "api-key",
  "openai-api-key",
  "anthropic-api-key",
  "gemini-api-key",
  "start-service",
  "save-settings",
  "skill-folder",
  "import-folder",
  "skill-list",
  "prompt-title",
  "prompt-body",
  "save-prompt",
  "prompt-list",
  "shortcut",
  "save-shortcut"
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.placeholder = "";
    this.textContent = "";
    this.innerHTML = "";
    this.style = {};
    this.dataset = {};
    this.listeners = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  trigger(type, event = { target: this }) {
    assert.ok(this.listeners[type], `${this.id} missing ${type} listener`);
    return this.listeners[type](event);
  }
}

function createDeleteButton(action, datasetKey, id) {
  return {
    dataset: {
      action,
      [datasetKey]: encodeURIComponent(id)
    },
    closest(selector) {
      return selector.includes(action) ? this : null;
    }
  };
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const elements = Object.fromEntries(elementIds.map((id) => [id, new FakeElement(id)]));
elements.provider.value = "auto";
elements["base-url"].value = "https://api.openai.com/v1";
elements.model.value = "gpt-4o-mini";
elements.shortcut.value = "CmdOrCtrl+Shift+Space";

const serviceState = {
  settings: {
    provider: "auto",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
    providerKeys: {
      "openai-compatible": "",
      anthropic: "",
      gemini: ""
    }
  },
  skills: [],
  prompts: []
};
const serviceRequests = [];
const tauriInvokes = [];
const localStorageValues = {};
let shortcutListener;

async function fakeFetch(url, options = {}) {
  const parsed = new URL(url);
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : null;
  serviceRequests.push({ method, path: parsed.pathname, body });

  if (method === "GET" && parsed.pathname === "/health") {
    return createResponse({ ok: true, service: "smart-prompt-local-service" });
  }
  if (method === "GET" && parsed.pathname === "/settings") {
    return createResponse({ ok: true, settings: serviceState.settings });
  }
  if (method === "PUT" && parsed.pathname === "/settings") {
    serviceState.settings = {
      ...serviceState.settings,
      ...body,
      apiKey: "",
      providerKeys: {
        ...serviceState.settings.providerKeys,
        ...(body.providerKeys || {})
      },
      uploadWholePage: false,
      autoSubmit: false
    };
    return createResponse({ ok: true, settings: serviceState.settings });
  }
  if (method === "GET" && parsed.pathname === "/llm/providers") {
    return createResponse({
      ok: true,
      selected: serviceState.settings.provider,
      auto: { provider: "gemini" },
      providers: [
        { provider: "openai-compatible", label: "OpenAI-compatible", keyAvailable: Boolean(serviceState.settings.providerKeys["openai-compatible"]) },
        { provider: "anthropic", label: "Anthropic", keyAvailable: Boolean(serviceState.settings.providerKeys.anthropic) },
        { provider: "gemini", label: "Gemini", keyAvailable: Boolean(serviceState.settings.providerKeys.gemini) }
      ]
    });
  }
  if (method === "GET" && parsed.pathname === "/skills") {
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "POST" && parsed.pathname === "/skills/import-folder") {
    serviceState.skills = [
      {
        id: "skill-imported",
        name: "imported-skill",
        description: `Imported from ${body.path}`
      }
    ];
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "DELETE" && parsed.pathname.startsWith("/skills/")) {
    const id = decodeURIComponent(parsed.pathname.slice("/skills/".length));
    serviceState.skills = serviceState.skills.filter((skill) => skill.id !== id);
    return createResponse({ ok: true, skills: serviceState.skills });
  }
  if (method === "GET" && parsed.pathname === "/prompts") {
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }
  if (method === "POST" && parsed.pathname === "/prompts") {
    serviceState.prompts = [
      {
        id: "prompt-saved",
        title: body.title,
        body: body.body,
        source: body.source
      }
    ];
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }
  if (method === "DELETE" && parsed.pathname.startsWith("/prompts/")) {
    const id = decodeURIComponent(parsed.pathname.slice("/prompts/".length));
    serviceState.prompts = serviceState.prompts.filter((prompt) => prompt.id !== id);
    return createResponse({ ok: true, prompts: serviceState.prompts });
  }

  return createResponse({ ok: false, error: { message: `Unhandled ${method} ${parsed.pathname}` } }, 404);
}

const context = {
  URL,
  assert,
  console,
  fetch: fakeFetch,
  document: {
    documentElement: new FakeElement("html"),
    getElementById(id) {
      assert.ok(elements[id], `missing fake element ${id}`);
      return elements[id];
    }
  },
  localStorage: {
    getItem(key) {
      return localStorageValues[key] || "";
    },
    setItem(key, value) {
      localStorageValues[key] = String(value);
    }
  },
  window: {}
};
context.window = {
  __TAURI__: {
    core: {
      async invoke(command, payload) {
        tauriInvokes.push({ command, payload });
        if (command === "set_global_shortcut") return payload.shortcut;
        if (command === "start_local_service") return "started";
        throw new Error(`Unhandled Tauri command ${command}`);
      }
    },
    event: {
      listen(eventName, handler) {
        assert.equal(eventName, "smart-prompt-shortcut");
        shortcutListener = handler;
        return Promise.resolve(() => {});
      }
    }
  }
};

(async () => {
  vm.createContext(context);
  vm.runInContext(appSource, context, { filename: "src/app.js" });

  await waitFor(() => elements["service-status"].textContent === "service online", "initial service load");
  assert.ok(elements["provider-status"].textContent.includes("Selected: auto"));
  assert.ok(elements["skill-list"].innerHTML.includes("No imported skills"));
  assert.ok(elements["prompt-list"].innerHTML.includes("No saved prompts"));

  elements.provider.value = "gemini";
  elements.provider.trigger("change");
  assert.equal(elements["base-url"].value, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(elements.model.value, "gemini-2.5-flash");

  elements["openai-api-key"].value = "sk-openai-test";
  elements["anthropic-api-key"].value = "sk-ant-test";
  elements["gemini-api-key"].value = "sk-gemini-test";
  await elements["save-settings"].trigger("click");
  await waitFor(() => serviceState.settings.providerKeys.gemini === "sk-gemini-test", "settings save");
  const settingsRequest = serviceRequests.find((request) => request.method === "PUT" && request.path === "/settings");
  assert.equal(settingsRequest.body.provider, "gemini");
  assert.equal(settingsRequest.body.providerKeys.anthropic, "sk-ant-test");
  assert.equal(elements["gemini-api-key"].value, "");

  elements["skill-folder"].value = "C:\\Users\\you\\.codex\\skills";
  await elements["import-folder"].trigger("click");
  await waitFor(() => elements["skill-list"].innerHTML.includes("imported-skill"), "skill import");
  assert.ok(serviceRequests.some((request) => request.method === "POST" && request.path === "/skills/import-folder" && request.body.path.includes(".codex")));

  await elements["skill-list"].trigger("click", {
    target: createDeleteButton("delete-skill", "skillId", "skill-imported")
  });
  await waitFor(() => elements["skill-list"].innerHTML.includes("No imported skills"), "skill delete");
  assert.ok(serviceRequests.some((request) => request.method === "DELETE" && request.path === "/skills/skill-imported"));

  elements["prompt-title"].value = "Reusable V2 prompt";
  elements["prompt-body"].value = "Build a careful V2 prompt with acceptance criteria.";
  await elements["save-prompt"].trigger("click");
  await waitFor(() => elements["prompt-list"].innerHTML.includes("Reusable V2 prompt"), "prompt save");
  assert.ok(serviceRequests.some((request) => request.method === "POST" && request.path === "/prompts" && request.body.source === "desktop-shell"));

  await elements["prompt-list"].trigger("click", {
    target: createDeleteButton("delete-prompt", "promptId", "prompt-saved")
  });
  await waitFor(() => elements["prompt-list"].innerHTML.includes("No saved prompts"), "prompt delete");
  assert.ok(serviceRequests.some((request) => request.method === "DELETE" && request.path === "/prompts/prompt-saved"));

  elements.shortcut.value = "Ctrl+Alt+P";
  await elements["save-shortcut"].trigger("click");
  assert.equal(localStorageValues.smartPromptShortcut, "Ctrl+Alt+P");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "set_global_shortcut" && invoke.payload.shortcut === "Ctrl+Alt+P"));

  await elements["start-service"].trigger("click");
  assert.ok(tauriInvokes.some((invoke) => invoke.command === "start_local_service"));

  assert.equal(context.window.__smartPromptEventsReady, true);
  shortcutListener({ payload: "Ctrl+Alt+P" });
  assert.equal(context.window.__smartPromptShortcutHits, 1);
  assert.equal(context.document.documentElement.dataset.lastShortcut, "Ctrl+Alt+P");

  console.log("desktop-shell interaction tests passed");
})();
