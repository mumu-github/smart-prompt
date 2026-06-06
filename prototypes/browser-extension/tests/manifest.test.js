const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.options_page, "options/options.html");
assert.ok(manifest.action.default_popup);
assert.ok(manifest.host_permissions.includes("http://127.0.0.1:17371/*"));
assert.ok(manifest.host_permissions.includes("http://localhost:17371/*"));
assert.ok(manifest.host_permissions.includes("https://v0.app/*"));
assert.ok(manifest.content_scripts[0].js.includes("src/site-adapters.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/local-service-client.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/prompt-engine.js"));
assert.ok(manifest.content_scripts[0].js.includes("src/content.js"));
assert.ok(manifest.content_scripts[0].css.includes("src/content.css"));

for (const resource of [
  "src/prompt-engine.js",
  "src/site-adapters.js",
  "src/local-service-client.js",
  "src/content.js",
  "src/content.css",
  "options/options.html",
  "options/options.js",
  "popup/popup.html",
  "popup/popup.js",
  "demo/demo.html",
  "assets/mascot-states/normal.png",
  "assets/mascot-states/thinking.png",
  "assets/mascot-states/suggesting.png",
  "assets/mascot-states/success.png"
]) {
  assert.ok(fs.existsSync(path.join(root, resource)), `missing ${resource}`);
}

console.log("manifest tests passed");
