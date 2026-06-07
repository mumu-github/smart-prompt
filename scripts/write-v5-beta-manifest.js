const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}

function sha256File(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function command(commandText) {
  try {
    return execSync(commandText, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function listInstallerArtifacts() {
  const bundleDir = path.join(root, "apps/desktop-shell/src-tauri/target/release/bundle");
  if (!fs.existsSync(bundleDir)) return [];
  const artifacts = [];
  const stack = [bundleDir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (/\.(msi|exe)$/i.test(item.name)) artifacts.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
  return artifacts.sort();
}

function status(pass, partial = false) {
  if (pass) return "PASS";
  return partial ? "PARTIAL" : "FAIL";
}

function gate({ pass, partial = false, evidence = [], ...extra }) {
  return { status: status(pass, partial), evidence, ...extra };
}

const tagName = "v0.2.0-beta.1";
const gitTags = command(`git tag --list ${tagName}`);
const recentSubjects = command("git log --format=%s -30").split(/\r?\n/).filter(Boolean);
const stagedFiles = command("git diff --name-only --cached").split(/\r?\n/).filter(Boolean);
const dirtyFiles = command("git diff --name-only").split(/\r?\n/).filter(Boolean);
const untrackedFiles = command("git ls-files --others --exclude-standard").split(/\r?\n/).filter(Boolean);
const installerArtifacts = listInstallerArtifacts();
const checksumsText = readText("research/v5-beta-checksums.sha256");
const releaseNotes = readText("docs/releases/v0.2.0-beta.1.md");
const pilotLoop = readText("research/v5-pilot-loop.md");
const desktopApp = readText("apps/desktop-shell/src/app.js");
const localService = readText("apps/local-service/src/server.js");
const tauriMain = readText("apps/desktop-shell/src-tauri/src/main.rs");

const groupedCommitPatterns = [
  /v3.*evidence|evidence.*v3/i,
  /v4.*evidence|evidence.*v4/i,
  /desktop/i,
  /local-service/i,
  /browser-extension|extension/i,
  /release|critic|script/i
];
const groupedCommitHits = groupedCommitPatterns.map((pattern) => recentSubjects.some((subject) => pattern.test(subject)));
const checksumLines = checksumsText.split(/\r?\n/).filter((line) => line.trim() && /^[a-f0-9]{64}\s+/i.test(line));
const checksumArtifactNames = checksumLines.map((line) => line.trim().split(/\s+/).slice(1).join(" "));
const checksumsCoverInstallers = installerArtifacts.length > 0
  && installerArtifacts.every((artifact) => checksumArtifactNames.includes(artifact));

const acceptance = {
  CLEAN_GROUPED_COMMITS: gate({
    pass: groupedCommitHits.every(Boolean) && !stagedFiles.includes("docs/prd.md"),
    partial: groupedCommitHits.some(Boolean),
    groupedCommitHits,
    docsPrdDirty: dirtyFiles.includes("docs/prd.md"),
    docsPrdStaged: stagedFiles.includes("docs/prd.md"),
    recentSubjects,
    evidence: ["git log --format=%s -30", "git diff --name-only --cached"]
  }),
  BETA_RELEASE_PACKAGE: gate({
    pass: Boolean(releaseNotes.includes(tagName) && checksumsCoverInstallers && gitTags === tagName),
    partial: Boolean(releaseNotes || checksumLines.length || installerArtifacts.length),
    tagName,
    tagExists: gitTags === tagName,
    installerArtifacts,
    checksumLines: checksumLines.length,
    checksumsCoverInstallers,
    evidence: [
      "docs/releases/v0.2.0-beta.1.md",
      "research/v5-beta-checksums.sha256",
      "apps/desktop-shell/src-tauri/target/release/bundle"
    ]
  }),
  NATIVE_SIDECAR_PASS: gate({
    pass: Boolean(
      exists("apps/local-service-sidecar/Cargo.toml")
      && exists("apps/local-service-sidecar/src/main.rs")
      && tauriMain.includes("local-service-sidecar")
    ),
    partial: Boolean(exists("apps/local-service-sidecar/Cargo.toml") || tauriMain.includes("local-service-sidecar")),
    evidence: ["apps/local-service-sidecar", "apps/desktop-shell/src-tauri/src/main.rs"]
  }),
  DIAGNOSTICS_PASS: gate({
    pass: [
      "diagnostics",
      "/diagnostics/export",
      "clear-all-local-data",
      "migrateProviderKeys",
      "portRecovery"
    ].every((token) => `${desktopApp}\n${localService}`.includes(token)),
    partial: ["diagnostics", "clear-all-local-data"].some((token) => `${desktopApp}\n${localService}`.includes(token)),
    evidence: ["apps/desktop-shell/src/app.js", "apps/local-service/src/server.js"]
  }),
  PILOT_LOOP_PASS: gate({
    pass: Boolean(
      pilotLoop.includes("Scenario 1")
      && pilotLoop.includes("Scenario 5")
      && pilotLoop.includes("Insert success rate")
      && pilotLoop.includes("adapter")
    ),
    partial: Boolean(pilotLoop),
    evidence: ["research/v5-pilot-loop.md"]
  })
};

const releaseReady = Object.values(acceptance).every((item) => item.status === "PASS");
const manifest = {
  createdAt: new Date().toISOString(),
  pass: releaseReady,
  releaseReady,
  tagName,
  acceptance,
  worktree: {
    dirtyFiles,
    untrackedFiles,
    stagedFiles
  },
  evidenceHashes: Object.fromEntries([
    "docs/releases/v0.2.0-beta.1.md",
    "research/v5-beta-checksums.sha256",
    "research/v5-pilot-loop.md",
    "scripts/write-v5-beta-manifest.js",
    "scripts/critic-v5.ps1"
  ].map((file) => [file, sha256File(file)]))
};

const out = path.join(root, "research/v5-beta-manifest.latest.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
if (!releaseReady) process.exitCode = 1;
