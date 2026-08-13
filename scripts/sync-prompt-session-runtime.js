const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const source = path.join(repoRoot, "packages", "prompt-session", "index.js");
const targets = [
  path.join(repoRoot, "prototypes", "browser-extension", "src", "prompt-session.js"),
  path.join(repoRoot, "apps", "desktop-shell", "src", "prompt-session.js")
];

for (const target of targets) {
  fs.copyFileSync(source, target);
}

console.log(`Synced Prompt Session runtime to ${targets.length} targets.`);
