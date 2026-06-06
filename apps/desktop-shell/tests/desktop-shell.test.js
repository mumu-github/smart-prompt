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
assert.ok(app.includes("/skills/import-folder"));
assert.ok(app.includes("set_global_shortcut"));
assert.ok(app.includes("start_local_service"));
assert.ok(app.includes("api-key"));

const rust = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
assert.ok(rust.includes("TrayIconBuilder"));
assert.ok(rust.includes("tauri_plugin_global_shortcut"));
assert.ok(rust.includes("set_global_shortcut"));
assert.ok(rust.includes("start_local_service"));
assert.ok(rust.includes("Command::new(\"node\")"));

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
assert.equal(tauriConfig.productName, "Smart Prompt");

console.log("desktop-shell static tests passed");
