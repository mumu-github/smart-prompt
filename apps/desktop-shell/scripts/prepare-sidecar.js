const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const resourcesRoot = path.join(desktopRoot, "src-tauri", "resources", "smart-prompt-sidecar");
const sidecarRoot = path.join(repoRoot, "apps", "local-service-sidecar");
const sidecarTargetRoot = path.join(sidecarRoot, "target");
const m3DesktopInputProbe = path.join(repoRoot, "scripts", "check-m3-desktop-input.ps1");
const m3DesktopFillProbe = path.join(repoRoot, "scripts", "check-m3-desktop-fill.ps1");
const desktopToolProfileConfigProbe = path.join(repoRoot, "scripts", "desktop-tool-profile-config.ps1");
const codexTargetAdapterDriver = path.join(repoRoot, "scripts", "codex-target-adapter-driver.ps1");
const desktopToolProfilesJson = path.join(repoRoot, "packages", "shared", "desktop-tool-profiles.json");

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
  const result = spawnSync(cargo, ["build", "--release", "--target-dir", sidecarTargetRoot], {
    cwd: sidecarRoot,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function assertNoEmbeddedRepoPath(binaryPath) {
  const binary = fs.readFileSync(binaryPath);
  const pathVariants = [...new Set([
    repoRoot,
    repoRoot.replace(/\\/g, "/")
  ])];
  const leaked = pathVariants.some((value) => (
    binary.includes(Buffer.from(value, "utf8"))
      || binary.includes(Buffer.from(value, "utf16le"))
  ));
  if (leaked) {
    throw new Error("Release sidecar contains an embedded repository path; refusing to package it.");
  }
}

function archiveExistingResources() {
  if (!fs.existsSync(resourcesRoot)) return "";
  const recoveryRoot = path.join(path.dirname(resourcesRoot), ".recovery");
  fs.mkdirSync(recoveryRoot, { recursive: true });
  let suffix = 0;
  let destination;
  do {
    const discriminator = suffix ? `-${suffix}` : "";
    destination = path.join(recoveryRoot, `smart-prompt-sidecar-${Date.now()}${discriminator}`);
    suffix += 1;
  } while (fs.existsSync(destination));
  fs.renameSync(resourcesRoot, destination);
  return destination;
}

runCargoBuild();
const executableName = process.platform === "win32" ? "local-service-sidecar.exe" : "local-service-sidecar";
const releaseExecutable = path.join(sidecarTargetRoot, "release", executableName);
assertNoEmbeddedRepoPath(releaseExecutable);
const archivedResources = archiveExistingResources();

copyFile(
  releaseExecutable,
  path.join(resourcesRoot, "bin", executableName)
);
copyFile(
  m3DesktopInputProbe,
  path.join(resourcesRoot, "scripts", "check-m3-desktop-input.ps1")
);
copyFile(
  m3DesktopFillProbe,
  path.join(resourcesRoot, "scripts", "check-m3-desktop-fill.ps1")
);
copyFile(
  desktopToolProfileConfigProbe,
  path.join(resourcesRoot, "scripts", "desktop-tool-profile-config.ps1")
);
copyFile(
  codexTargetAdapterDriver,
  path.join(resourcesRoot, "scripts", "codex-target-adapter-driver.ps1")
);
copyFile(
  desktopToolProfilesJson,
  path.join(resourcesRoot, "packages", "shared", "desktop-tool-profiles.json")
);

console.log(`Prepared native local-service sidecar executable at ${resourcesRoot}`);
if (archivedResources) {
  console.log(`Previous sidecar resources retained at ${archivedResources}`);
}
