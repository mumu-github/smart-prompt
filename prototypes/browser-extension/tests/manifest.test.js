const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const backgroundSource = fs.readFileSync(path.join(root, "src", "background.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(root, "options", "options.html"), "utf8");
const { SITE_ADAPTERS } = require("../src/site-adapters.js");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.options_page, "options/options.html");
assert.ok(manifest.action.default_popup);
assert.deepEqual(manifest.icons, {
  "16": "assets/icons/icon-16.png",
  "32": "assets/icons/icon-32.png",
  "48": "assets/icons/icon-48.png",
  "128": "assets/icons/icon-128.png"
});
assert.deepEqual(manifest.action.default_icon, manifest.icons);
assert.ok(manifest.host_permissions.includes("http://127.0.0.1:17371/*"));
assert.ok(manifest.host_permissions.includes("http://localhost:17371/*"));
assert.ok(manifest.host_permissions.includes("https://v0.app/*"));
assert.equal(manifest.version, "0.2.6");
assert.equal(packageJson.version, manifest.version);
assert.equal(manifest.key.length > 100, true);
assert.equal(manifest.background.service_worker, "src/background.js");
const adapterMatches = SITE_ADAPTERS.flatMap((adapter) => adapter.hostnames.map((host) => `https://${host}/*`)).sort();
const localServiceMatches = ["http://127.0.0.1:17371/*", "http://localhost:17371/*"];
assert.deepEqual([...manifest.host_permissions].sort(), [...adapterMatches, ...localServiceMatches].sort());
assert.deepEqual([...manifest.content_scripts[0].matches].sort(), adapterMatches);
assert.ok(manifest.content_scripts[0].js.indexOf("src/smart-prompt-core.js") < manifest.content_scripts[0].js.indexOf("src/prompt-engine.js"));
assert.ok(manifest.content_scripts[0].js.indexOf("src/prompt-session.js") < manifest.content_scripts[0].js.indexOf("src/content.js"));
assert.ok(manifest.content_scripts[0].js.indexOf("src/assistant-card.js") < manifest.content_scripts[0].js.indexOf("src/content.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/prompt-session.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/assistant-card.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/site-adapters.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/local-service-client.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/prompt-engine.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/content.js"));
assert.ok(manifest.content_scripts[0].css.includes("src/content.css"));

const optionsScripts = [...optionsHtml.matchAll(/<script\s+src=["']([^"']+)["'][^>]*>/g)]
  .map((match) => match[1]);
assert.ok(optionsScripts.includes("../src/smart-prompt-core.js"), "options page must load the shared core");
assert.ok(
  optionsScripts.indexOf("../src/smart-prompt-core.js") < optionsScripts.indexOf("../src/prompt-engine.js"),
  "options page must load the shared core before prompt-engine.js"
);

for (const resource of [
  "src/prompt-engine.js",
  "src/prompt-session.js",
  "src/assistant-card.js",
  "src/assistant-card.css",
  "src/smart-prompt-core.js",
  "src/site-adapters.js",
  "src/local-service-client.js",
  "src/background.js",
  "src/content.js",
  "src/content.css",
  "_locales/en/messages.json",
  "_locales/zh_CN/messages.json",
  "options/options.html",
  "options/options.js",
  "popup/popup.html",
  "popup/popup.js",
  "demo/demo.html",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png",
  "assets/mascot-states/normal.png",
  "assets/mascot-states/thinking.png",
  "assets/mascot-states/suggesting.png",
  "assets/mascot-states/success.png"
]) {
  assert.ok(fs.existsSync(path.join(root, resource)), `missing ${resource}`);
}

assert.equal(
  fs.readFileSync(path.join(root, "src/prompt-session.js"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "packages/prompt-session/index.js"), "utf8"),
  "browser Prompt Session runtime must match the shared source"
);
assert.equal(
  fs.readFileSync(path.join(root, "src/assistant-card.js"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "packages/assistant-ui/assistant-card.js"), "utf8"),
  "browser Assistant Card runtime must match the shared source"
);
assert.equal(
  fs.readFileSync(path.join(root, "src/assistant-card.css"), "utf8"),
  fs.readFileSync(path.join(repoRoot, "packages/assistant-ui/assistant-card.css"), "utf8"),
  "browser Assistant Card styles must match the shared source"
);
assert.ok(
  manifest.web_accessible_resources.some((entry) => entry.resources.includes("src/assistant-card.css")),
  "Assistant Card shadow stylesheet must be web accessible"
);
assert.ok(backgroundSource.includes('const DEFAULT_SERVICE_PORT = "17371"'));
assert.ok(backgroundSource.includes('if (parsed.port && parsed.port !== DEFAULT_SERVICE_PORT) return DEFAULT_SERVICE_URL;'));
assert.ok(contentSource.includes('const CONTENT_BUILD_ID = "phase3-extension-20260717-r5";'));
assert.ok(contentSource.includes("document.documentElement.dataset.smartPromptRuntimeBuild = CONTENT_BUILD_ID;"));
assert.ok(contentSource.includes("siteAdapters?.WRITE_CONTRACT_VERSION !== WRITE_CONTRACT_VERSION"));
assert.ok(contentSource.includes("activationEvidence?.ACTIVATION_PROOF_VERSION !== ACTIVATION_PROOF_VERSION"));
assert.ok(contentSource.includes("promptSessionApi.mapReason(error, promptSessionApi.REASONS.GENERATION_FAILED)"));
assert.ok(contentSource.includes("statusCredentialInvalid"));
assert.ok(contentSource.includes("statusModelUnavailable"));
assert.ok(contentSource.includes("statusNetworkUnavailable"));
assert.ok(contentSource.includes("statusProviderError"));
assert.ok(contentSource.includes('serviceState: "degraded"'));
assert.ok(contentSource.includes("if (state.activationBrowserSeenPromise) await state.activationBrowserSeenPromise;"));

console.log("manifest tests passed");
