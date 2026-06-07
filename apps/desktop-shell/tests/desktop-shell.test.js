const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "package.json",
  "index.html",
  "src/app.js",
  "src/styles.css",
  "scripts/prepare-dist.js",
  "scripts/prepare-sidecar.js",
  "tests/desktop-shell-interaction.test.js",
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
  "src-tauri/Cargo.toml",
  "src-tauri/src/main.rs"
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
assert.ok(app.includes("/settings"));
assert.ok(app.includes("/auth/bootstrap"));
assert.ok(app.includes("Authorization"));
assert.ok(app.includes("serviceAuthToken"));
assert.ok(app.includes("provider"));
assert.ok(app.includes("PROVIDER_DEFAULTS"));
assert.ok(app.includes("applyProviderDefaults"));
assert.ok(app.includes("/llm/providers"));
assert.ok(app.includes("/llm/test"));
assert.ok(app.includes("renderProviderStatus"));
assert.ok(app.includes("renderFirstRunProgress"));
assert.ok(app.includes("testProvider"));
assert.ok(app.includes("smartPromptProviderTestPass"));
assert.ok(app.includes("collectProviderKeys"));
assert.ok(app.includes("providerKeys"));
assert.ok(app.includes("agnes-2.0-flash"));
assert.ok(app.includes("agnes-api-key"));
assert.ok(app.includes("claude-sonnet-4-20250514"));
assert.ok(app.includes("gemini-2.5-flash"));
assert.ok(app.includes("/skills/import-folder"));
assert.ok(app.includes("/skills/${encodeURIComponent(id)}"));
assert.ok(app.includes("deleteSkill"));
assert.ok(app.includes("delete-skill"));
assert.ok(app.includes("/prompts"));
assert.ok(app.includes("/prompts/${encodeURIComponent(id)}"));
assert.ok(app.includes("deletePrompt"));
assert.ok(app.includes("delete-prompt"));
assert.ok(app.includes("handleSkillListAction"));
assert.ok(app.includes("handlePromptListAction"));
assert.ok(app.includes("set_global_shortcut"));
assert.ok(app.includes("start_local_service"));
assert.ok(app.includes("stop_local_service"));
assert.ok(app.includes("get_local_service_status"));
assert.ok(app.includes("refreshLocalServiceStatus"));
assert.ok(app.includes("localServiceStatus"));
assert.ok(app.includes("api-key"));
assert.ok(app.includes("agnes-api-key"));
assert.ok(app.includes("openai-api-key"));
assert.ok(app.includes("anthropic-api-key"));
assert.ok(app.includes("gemini-api-key"));
assert.ok(app.includes("smart-prompt-shortcut"));
assert.ok(app.includes("__smartPromptShortcutHits"));
assert.ok(app.includes("__smartPromptEventsReady"));
assert.ok(app.includes('classList.toggle("is-online"'));
assert.ok(!app.includes("style.color"));

const prepareDist = fs.readFileSync(path.join(root, "scripts/prepare-dist.js"), "utf8");
assert.ok(prepareDist.includes("copyFile(\"index.html\")"));
assert.ok(prepareDist.includes("copyDir(\"src\")"));
assert.ok(prepareDist.includes("fs.rmSync(dist"));

const prepareSidecar = fs.readFileSync(path.join(root, "scripts/prepare-sidecar.js"), "utf8");
assert.ok(prepareSidecar.includes("smart-prompt-sidecar"));
assert.ok(prepareSidecar.includes("apps\", \"local-service\", \"src"));
assert.ok(prepareSidecar.includes("packages\", \"shared"));
assert.ok(prepareSidecar.includes("process.execPath"));

const interactionTest = fs.readFileSync(path.join(root, "tests/desktop-shell-interaction.test.js"), "utf8");
assert.ok(interactionTest.includes("vm.runInContext"));
assert.ok(interactionTest.includes("fakeFetch"));
assert.ok(interactionTest.includes("/auth/bootstrap"));
assert.ok(interactionTest.includes("auth_required"));
assert.ok(interactionTest.includes("/settings"));
assert.ok(interactionTest.includes("/llm/test"));
assert.ok(interactionTest.includes("/skills/import-folder"));
assert.ok(interactionTest.includes("/prompts"));
assert.ok(interactionTest.includes("set_global_shortcut"));
assert.ok(interactionTest.includes("start_local_service"));
assert.ok(interactionTest.includes("stop_local_service"));
assert.ok(interactionTest.includes("get_local_service_status"));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(html.includes("Prompt Library"));
assert.ok(html.includes('id="first-run-panel"'));
assert.ok(html.includes('id="first-run-progress"'));
assert.ok(html.includes('id="privacy-boundary"'));
assert.ok(html.includes('id="test-provider"'));
assert.ok(html.includes('id="provider-test-status"'));
assert.ok(html.includes("No full page body"));
assert.ok(html.includes("No auto-submit"));
assert.ok(html.includes('id="provider"'));
assert.ok(html.includes('value="auto"'));
assert.ok(html.includes('value="agnes"'));
assert.ok(html.includes("provider-status"));
assert.ok(html.includes("agnes-api-key"));
assert.ok(html.includes("openai-compatible"));
assert.ok(html.includes("anthropic"));
assert.ok(html.includes("gemini"));
assert.ok(html.includes("openai-api-key"));
assert.ok(html.includes("anthropic-api-key"));
assert.ok(html.includes("gemini-api-key"));
assert.ok(html.includes("prompt-title"));
assert.ok(html.includes("prompt-body"));
assert.ok(html.includes("save-prompt"));
assert.ok(html.includes("stop-service"));

const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
assert.ok(css.includes(".setup-panel"));
assert.ok(css.includes(".setup-progress"));
assert.ok(css.includes(".privacy-boundary"));
assert.ok(css.includes(".library-row"));
assert.ok(css.includes(".row-action"));
assert.ok(css.includes(".status-pill.is-online"));
assert.ok(css.includes(".status-pill.is-offline"));

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
assert.ok(rust.includes("stop_local_service"));
assert.ok(rust.includes("get_local_service_status"));
assert.ok(rust.includes("get_local_service_source"));
assert.ok(rust.includes("LocalServiceRuntimeState"));
assert.ok(rust.includes("Mutex<Option<Child>>"));
assert.ok(rust.includes("find_local_service_script(&app)"));
assert.ok(rust.includes("find_node_runtime(&app)"));
assert.ok(rust.includes("resources/smart-prompt-sidecar"));
assert.ok(rust.includes("SMART_PROMPT_DATA_DIR"));
assert.ok(rust.includes("Stdio::null"));
assert.ok(!rust.includes("tauri_plugin_shell::init"));

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
assert.equal(tauriConfig.productName, "Smart Prompt");
assert.equal(tauriConfig.build.beforeBuildCommand, "npm run prepare-release");
assert.equal(tauriConfig.build.frontendDist, "../dist");
assert.equal(tauriConfig.app.withGlobalTauri, true);
assert.equal(tauriConfig.app.windows[0].label, "main");
assert.ok(tauriConfig.bundle.resources.includes("resources/smart-prompt-sidecar/"));
assert.ok(tauriConfig.app.security.csp.includes("default-src 'self'"));
assert.ok(tauriConfig.app.security.csp.includes("connect-src"));
assert.ok(tauriConfig.app.security.csp.includes("http://127.0.0.1:17371"));
assert.ok(tauriConfig.app.security.csp.includes("object-src 'none'"));
assert.ok(!tauriConfig.app.security.csp.includes("unsafe-eval"));

const capability = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/capabilities/default.json"), "utf8"));
assert.deepEqual(capability.windows, ["main"]);
assert.deepEqual(capability.permissions, [
  "core:event:allow-listen",
  "core:event:allow-unlisten"
]);
assert.ok(!capability.permissions.includes("core:default"));
assert.ok(!capability.permissions.some((permission) => permission.startsWith("shell:")));

console.log("desktop-shell static tests passed");
