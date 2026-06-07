const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const resourcesRoot = path.join(desktopRoot, "src-tauri", "resources", "smart-prompt-sidecar");
const sidecarRoot = path.join(repoRoot, "apps", "local-service-sidecar");

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function runCargoBuild() {
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const separator = process.platform === "win32" ? ";" : ":";
  const env = {
    ...process.env,
    PATH: `${cargoBin}${separator}${process.env.PATH || ""}`
  };
  const cargo = process.platform === "win32"
    ? path.join(cargoBin, "cargo.exe")
    : "cargo";
  const result = spawnSync(cargo, ["build", "--release"], {
    cwd: sidecarRoot,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

fs.rmSync(resourcesRoot, { recursive: true, force: true });
runCargoBuild();

const executableName = process.platform === "win32" ? "local-service-sidecar.exe" : "local-service-sidecar";
copyFile(
  path.join(sidecarRoot, "target", "release", executableName),
  path.join(resourcesRoot, "bin", executableName)
);

console.log(`Prepared native local-service sidecar executable at ${resourcesRoot}`);
