const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "package.json",
  "index.html",
  "src/app.js",
  "src/styles.css",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/src/main.rs"
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
assert.ok(app.includes("/settings"));
assert.ok(app.includes("provider"));
assert.ok(app.includes("PROVIDER_DEFAULTS"));
assert.ok(app.includes("applyProviderDefaults"));
assert.ok(app.includes("/llm/providers"));
assert.ok(app.includes("renderProviderStatus"));
assert.ok(app.includes("collectProviderKeys"));
assert.ok(app.includes("providerKeys"));
assert.ok(app.includes("claude-sonnet-4-20250514"));
assert.ok(app.includes("gemini-2.5-flash"));
assert.ok(app.includes("/skills/import-folder"));
assert.ok(app.includes("/prompts"));
assert.ok(app.includes("set_global_shortcut"));
assert.ok(app.includes("start_local_service"));
assert.ok(app.includes("api-key"));
assert.ok(app.includes("openai-api-key"));
assert.ok(app.includes("anthropic-api-key"));
assert.ok(app.includes("gemini-api-key"));
assert.ok(app.includes("smart-prompt-shortcut"));
assert.ok(app.includes("__smartPromptShortcutHits"));
assert.ok(app.includes("__smartPromptEventsReady"));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(html.includes("Prompt Library"));
assert.ok(html.includes('id="provider"'));
assert.ok(html.includes('value="auto"'));
assert.ok(html.includes("provider-status"));
assert.ok(html.includes("openai-compatible"));
assert.ok(html.includes("anthropic"));
assert.ok(html.includes("gemini"));
assert.ok(html.includes("openai-api-key"));
assert.ok(html.includes("anthropic-api-key"));
assert.ok(html.includes("gemini-api-key"));
assert.ok(html.includes("prompt-title"));
assert.ok(html.includes("prompt-body"));
assert.ok(html.includes("save-prompt"));

const rust = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
assert.ok(rust.includes("TrayIconBuilder"));
assert.ok(rust.includes("tauri_plugin_global_shortcut"));
assert.ok(rust.includes("set_global_shortcut"));
assert.ok(rust.includes("get_shortcut_hits"));
assert.ok(rust.includes("on_shortcut"));
assert.ok(rust.includes("ShortcutState::Pressed"));
assert.ok(rust.includes("ShortcutRuntimeState"));
assert.ok(rust.includes("Code::KeyP"));
assert.ok(rust.includes("start_local_service"));
assert.ok(rust.includes("Command::new(\"node\")"));

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
assert.equal(tauriConfig.productName, "Smart Prompt");
assert.equal(tauriConfig.app.withGlobalTauri, true);

console.log("desktop-shell static tests passed");
