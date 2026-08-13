const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sources = ["assistant-card.js", "assistant-card.css"];
const targetDirectories = [
  path.join(repoRoot, "prototypes", "browser-extension", "src"),
  path.join(repoRoot, "apps", "desktop-shell", "src")
];

for (const file of sources) {
  const source = path.join(repoRoot, "packages", "assistant-ui", file);
  for (const targetDirectory of targetDirectories) {
    fs.copyFileSync(source, path.join(targetDirectory, file));
  }
}

console.log(`Synced Assistant UI runtime (${sources.length} files) to ${targetDirectories.length} targets.`);
