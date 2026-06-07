const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const resourcesRoot = path.join(desktopRoot, "src-tauri", "resources", "smart-prompt-sidecar");

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(sourceDir, targetDir) {
  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, item.name);
    const target = path.join(targetDir, item.name);
    if (item.isDirectory()) {
      copyDir(source, target);
    } else {
      copyFile(source, target);
    }
  }
}

fs.rmSync(resourcesRoot, { recursive: true, force: true });

copyDir(
  path.join(repoRoot, "apps", "local-service", "src"),
  path.join(resourcesRoot, "apps", "local-service", "src")
);
copyFile(
  path.join(repoRoot, "apps", "local-service", "package.json"),
  path.join(resourcesRoot, "apps", "local-service", "package.json")
);
copyDir(
  path.join(repoRoot, "packages", "shared"),
  path.join(resourcesRoot, "packages", "shared")
);

const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFile(process.execPath, path.join(resourcesRoot, "bin", nodeName));

console.log(`Prepared local-service sidecar resources at ${resourcesRoot}`);
