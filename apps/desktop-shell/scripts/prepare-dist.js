const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const recoveryRoot = path.resolve(root, "..", "..", ".runtime", "desktop-shell-dist");

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

function archiveExistingDist() {
  if (!fs.existsSync(dist)) return "";
  fs.mkdirSync(recoveryRoot, { recursive: true });
  let suffix = 0;
  let destination;
  do {
    const discriminator = suffix ? `-${suffix}` : "";
    destination = path.join(recoveryRoot, `dist-${Date.now()}${discriminator}`);
    suffix += 1;
  } while (fs.existsSync(destination));
  fs.renameSync(dist, destination);
  return destination;
}

const archivedDist = archiveExistingDist();
copyFile("index.html");
copyFile("overlay.html");
copyDir("src");
console.log(`Prepared desktop shell dist at ${dist}`);
if (archivedDist) {
  console.log(`Previous desktop shell dist retained at ${archivedDist}`);
}
