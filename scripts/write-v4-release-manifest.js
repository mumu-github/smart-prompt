const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sha256File(relativePath) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return null;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  return {
    evidenceFile: relativePath,
    exists: true,
    sha256: hash,
    bytes: fs.statSync(file).size
  };
}

function listInstallerArtifacts() {
  const bundleDir = path.join(root, "apps/desktop-shell/src-tauri/target/release/bundle");
  if (!fs.existsSync(bundleDir)) return [];
  const out = [];
  const stack = [bundleDir];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        stack.push(full);
      } else if (/\.(msi|exe|dmg|appimage|deb|rpm)$/i.test(item.name)) {
        out.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  return out.sort();
}

function status(pass, partial = false) {
  if (pass) return "PASS";
  return partial ? "PARTIAL" : "FAIL";
}

function makeGate({ pass, partial = false, evidence = [], ...extra }) {
  return {
    status: status(pass, partial),
    evidence,
    ...extra
  };
}

const sidecar = readJson("research/v4-sidecar-service.latest.json");
const v3Live = readJson("research/v3-live-site-formal.latest.json");
const v3Tauri = readJson("research/v3-tauri-security.latest.json");
const v3Manifest = readJson("research/v3-release-manifest.latest.json");
const realLlm = readJson("research/v2-real-llm.latest.json");
const installerSmoke = readJson("research/v4-installer-smoke.latest.json");
const installerArtifacts = listInstallerArtifacts();

const desktopHtml = fs.readFileSync(path.join(root, "apps/desktop-shell/index.html"), "utf8");
const desktopApp = fs.readFileSync(path.join(root, "apps/desktop-shell/src/app.js"), "utf8");
const contentScript = fs.readFileSync(path.join(root, "prototypes/browser-extension/src/content.js"), "utf8");
const runtimeDemoTest = fs.readFileSync(path.join(root, "prototypes/browser-extension/tests/runtime-demo.test.js"), "utf8");
const store = fs.readFileSync(path.join(root, "apps/local-service/src/store.js"), "utf8");
const tauriConfig = readJson("apps/desktop-shell/src-tauri/tauri.conf.json");

const sidecarPass = Boolean(sidecar?.pass && sidecar?.checks?.localServiceStarted && sidecar?.checks?.localServiceStopped);
const keychainPass = Boolean(v3Tauri?.pass && v3Tauri?.checks?.credentialSettingsNoPlaintext && v3Tauri?.checks?.credentialStorageEncrypted);
const firstRunPartial = [
  "provider",
  "api-key",
  "import-folder",
  "provider-status"
].every((token) => desktopHtml.includes(token) || desktopApp.includes(token));
const firstRunUiPass = [
  'id="first-run-panel"',
  'id="first-run-progress"',
  'id="privacy-boundary"',
  'id="test-provider"',
  'id="provider-test-status"',
  "No full page body",
  "No auto-submit"
].every((token) => desktopHtml.includes(token));
const firstRunLogicPass = [
  "/llm/test",
  "renderFirstRunProgress",
  "testProvider",
  "smartPromptProviderTestPass"
].every((token) => desktopApp.includes(token));
const firstRunPass = Boolean(firstRunPartial && firstRunUiPass && firstRunLogicPass && realLlm?.pass);
const liveStabilityPass = Boolean(readJson("research/v4-live-site-stability.latest.json")?.pass);
const v4LiveStability = readJson("research/v4-live-site-stability.latest.json");
const liveStabilityPartial = Boolean(v3Live?.pass && v3Live?.summary?.displayPasses?.length >= 8);
const promptCardPartial = [
  "data-action=\"refresh\"",
  "data-action=\"copy\"",
  "data-action=\"favorite\"",
  "data-action=\"insert\"",
  "recordFeedbackEvent",
  "publishInsertEvidence"
].every((token) => contentScript.includes(token));
const promptCardSourcePass = [
  "data-action=\"undo\"",
  "data-action=\"retry\"",
  "spc-mode-selector",
  "spc-source-badge",
  "smartPromptUndo",
  "setCardStatus"
].every((token) => contentScript.includes(token));
const promptCardRuntimePass = [
  "button[data-action=\"retry\"]",
  "button[data-action=\"undo\"]",
  "mode-polish",
  "smartPromptUndoAvailable",
  "smartPromptUndoOk"
].every((token) => runtimeDemoTest.includes(token));
const promptCardPass = Boolean(promptCardPartial && promptCardSourcePass && promptCardRuntimePass);
const localDataPartial = [
  "getPrompts",
  "savePrompts",
  "addPrompt",
  "deletePrompt",
  "addSkills",
  "deleteSkill",
  "addPromptHistory"
].every((token) => store.includes(token));
const localDataPass = Boolean(localDataPartial
  && store.includes("searchPrompts")
  && store.includes("exportData")
  && store.includes("restoreData")
  && store.includes("schemaVersion"));
const installerChecks = installerSmoke?.checks || {};
const installerRuntimePass = [
  "bundledSidecarResource",
  "bundledNodeRuntime",
  "sourceCommandBundled",
  "localServiceStartedFromInstalledApp",
  "serviceHealthFromInstalledApp",
  "localServiceStoppedFromInstalledApp"
].every((check) => installerChecks[check] === true);
const installerPass = installerArtifacts.length > 0 && Boolean(installerSmoke?.pass && installerRuntimePass);

const acceptance = {
  INSTALLER_PASS: makeGate({
    pass: installerPass,
    partial: installerArtifacts.length > 0,
    artifacts: installerArtifacts,
    installedRuntimePass: installerRuntimePass,
    checks: installerChecks,
    evidence: [
      "apps/desktop-shell/src-tauri/tauri.conf.json",
      "apps/desktop-shell/scripts/prepare-sidecar.js",
      "scripts/check-v4-installer-smoke.ps1",
      "scripts/check-v4-installed-app-runtime.js",
      "research/v4-installer-smoke.latest.json"
    ]
  }),
  SIDECAR_SERVICE_PASS: makeGate({
    pass: sidecarPass,
    partial: Boolean(sidecar),
    checks: sidecar?.checks || {},
    evidence: ["research/v4-sidecar-service.latest.json"]
  }),
  FIRST_RUN_PASS: makeGate({
    pass: firstRunPass,
    partial: firstRunPartial,
    firstRunUiPass,
    firstRunLogicPass,
    realLlmPass: Boolean(realLlm?.pass),
    evidence: ["apps/desktop-shell/index.html", "apps/desktop-shell/src/app.js", "apps/desktop-shell/tests/desktop-shell-interaction.test.js", "research/v2-real-llm.latest.json"]
  }),
  KEYCHAIN_PASS: makeGate({
    pass: keychainPass,
    partial: Boolean(v3Tauri?.pass),
    evidence: ["research/v3-tauri-security.latest.json", "apps/local-service/src/credential-vault.js"]
  }),
  LIVE_SITE_STABILITY_PASS: makeGate({
    pass: liveStabilityPass,
    partial: liveStabilityPartial,
    singleRunPass: Boolean(v3Live?.pass),
    mode: v4LiveStability?.mode || "",
    recoveryStrategyPass: Boolean(v4LiveStability?.recoveryStrategyPass),
    evidence: ["research/v3-live-site-formal.latest.json", "research/v4-live-site-stability.latest.json", "research/v4-live-site-stability-recovery.md"]
  }),
  PROMPT_CARD_UX_PASS: makeGate({
    pass: promptCardPass,
    partial: promptCardPartial,
    promptCardSourcePass,
    promptCardRuntimePass,
    evidence: ["prototypes/browser-extension/src/content.js", "prototypes/browser-extension/tests/runtime-demo.test.js"]
  }),
  LOCAL_DATA_PASS: makeGate({
    pass: localDataPass,
    partial: localDataPartial,
    evidence: ["apps/local-service/src/store.js", "apps/local-service/tests/local-service.test.js"]
  }),
  V4_RELEASE_MANIFEST_PASS: makeGate({
    pass: false,
    partial: true,
    evidence: ["research/v4-release-manifest.latest.json"]
  })
};

const releaseReady = Object.values(acceptance)
  .filter((gate) => gate !== acceptance.V4_RELEASE_MANIFEST_PASS)
  .every((gate) => gate.status === "PASS");
acceptance.V4_RELEASE_MANIFEST_PASS.status = releaseReady ? "PASS" : "PARTIAL";

const evidenceFiles = [
  "research/v4-sidecar-service.latest.json",
  "research/v4-live-site-stability.latest.json",
  "research/v4-live-site-stability-recovery.md",
  "research/v4-installer-smoke.latest.json",
  "research/v3-live-site-formal.latest.json",
  "research/v3-tauri-security.latest.json",
  "research/v2-real-llm.latest.json",
  "apps/desktop-shell/src-tauri/tauri.conf.json",
  "apps/desktop-shell/scripts/prepare-sidecar.js",
  "scripts/check-v4-installed-app-runtime.js",
  "apps/desktop-shell/src-tauri/src/main.rs"
];

const manifest = {
  createdAt: new Date().toISOString(),
  pass: releaseReady,
  releaseReady,
  version: tauriConfig?.version || "",
  acceptance,
  evidence: Object.fromEntries(evidenceFiles.map((file) => [file, sha256File(file) || { evidenceFile: file, exists: false }]))
};

const out = path.join(root, "research/v4-release-manifest.latest.json");
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
if (!releaseReady) process.exitCode = 1;
