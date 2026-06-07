const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { redactEvidence } = require("../packages/shared/evidence-redaction");
const { createStore } = require("../apps/local-service/src/store");

const root = path.resolve(__dirname, "..");
const reportPath = process.env.SMART_PROMPT_V3_TAURI_REPORT || path.join(root, "research/v3-tauri-security.latest.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function containsAny(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

(async () => {
  const tauriConfigPath = path.join(root, "apps/desktop-shell/src-tauri/tauri.conf.json");
  const capabilityPath = path.join(root, "apps/desktop-shell/src-tauri/capabilities/default.json");
  const mainPath = path.join(root, "apps/desktop-shell/src-tauri/src/main.rs");
  const cargoPath = path.join(root, "apps/desktop-shell/src-tauri/Cargo.toml");
  const tauriConfig = readJson(tauriConfigPath);
  const capability = readJson(capabilityPath);
  const main = fs.readFileSync(mainPath, "utf8");
  const cargo = fs.readFileSync(cargoPath, "utf8");
  const csp = tauriConfig.app?.security?.csp || "";
  const checks = {
    cspConfigured: typeof csp === "string" && csp.length > 40 && csp.includes("default-src 'self'"),
    cspBlocksDangerousSources: !containsAny(csp, ["unsafe-eval", " *", "data: *"]) && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"),
    cspAllowsLocalServiceOnly: csp.includes("connect-src") && csp.includes("http://127.0.0.1:17371") && !csp.includes("https://*"),
    mainWindowLabeled: tauriConfig.app?.windows?.[0]?.label === "main",
    globalTauriScoped: tauriConfig.app?.withGlobalTauri === true && fs.existsSync(capabilityPath) && capability.windows?.length === 1,
    capabilityMainOnly: JSON.stringify(capability.windows || []) === JSON.stringify(["main"]),
    capabilityNoWildcard: !(capability.windows || []).includes("*"),
    capabilityMinimalPermissions: JSON.stringify(capability.permissions || []) === JSON.stringify([
      "core:event:allow-listen",
      "core:event:allow-unlisten"
    ]),
    shellPluginRemoved: !main.includes("tauri_plugin_shell::init") && !cargo.includes("tauri-plugin-shell"),
    explicitInvokeHandler: [
      "set_global_shortcut",
      "get_shortcut_hits",
      "get_local_service_source",
      "start_local_service",
      "stop_local_service"
    ].every((command) => main.includes(command))
  };

  const dataDir = tempDir("smart-prompt-v3-vault-");
  try {
    const store = createStore(dataDir);
    const settings = store.saveSettings({
      provider: "agnes",
      providerKeys: {
        agnes: "sk-v3-tauri-agnes-secret",
        gemini: "sk-v3-tauri-gemini-secret"
      }
    });
    const settingsText = fs.readFileSync(path.join(dataDir, "settings.json"), "utf8");
    const vaultText = fs.readFileSync(path.join(dataDir, "provider-keys.json"), "utf8");
    checks.credentialVaultReturnsKeys = settings.providerKeys.agnes === "sk-v3-tauri-agnes-secret"
      && settings.providerKeys.gemini === "sk-v3-tauri-gemini-secret";
    checks.credentialSettingsNoPlaintext = !containsAny(settingsText, ["sk-v3-tauri-agnes-secret", "sk-v3-tauri-gemini-secret"]);
    checks.credentialVaultNoPlaintext = !containsAny(vaultText, ["sk-v3-tauri-agnes-secret", "sk-v3-tauri-gemini-secret"]);
    checks.credentialStorageEncrypted = settings.credentialStorage?.encrypted === true;
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const report = redactEvidence({
    createdAt: new Date().toISOString(),
    pass: Object.values(checks).every(Boolean),
    tauri: {
      withGlobalTauri: tauriConfig.app?.withGlobalTauri,
      cspLength: csp.length,
      capability: {
        identifier: capability.identifier,
        windows: capability.windows,
        permissions: capability.permissions
      },
      invokeCommands: [
        "set_global_shortcut",
        "get_shortcut_hits",
        "get_local_service_source",
        "start_local_service",
        "stop_local_service"
      ]
    },
    checks
  });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.pass, true, `V3 Tauri security check failed: ${JSON.stringify(checks)}`);
})();
