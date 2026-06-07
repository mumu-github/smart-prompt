const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const target = path.join(dist, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(relativePath) {
  const sourceDir = path.join(root, relativePath);
  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const child = path.join(relativePath, item.name);
    if (item.isDirectory()) copyDir(child);
    else copyFile(child);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyFile("index.html");
copyDir("src");
console.log(`Prepared desktop shell dist at ${dist}`);
