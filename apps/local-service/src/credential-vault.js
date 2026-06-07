const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const VAULT_FILE = "provider-keys.json";
const VAULT_VERSION = 1;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function powershellDpapi(mode, text) {
  if (process.platform !== "win32") return "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$inputText = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Convert]::FromBase64String($inputText)",
    `if ('${mode}' -eq 'protect') {`,
    "  $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "} else {",
    "  $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "}",
    "[Convert]::ToBase64String($out)"
  ].join("; ");
  const input = mode === "protect"
    ? Buffer.from(String(text), "utf8").toString("base64")
    : String(text);
  const result = childProcess.spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    input,
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function createAesKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function aesEncrypt(text, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", createAesKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function aesDecrypt(record, secret) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    createAesKey(secret),
    Buffer.from(record.iv || "", "base64")
  );
  decipher.setAuthTag(Buffer.from(record.tag || "", "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext || "", "base64")),
    decipher.final()
  ]).toString("utf8");
}

function getFallbackSecret(dataDir) {
  if (process.env.SMART_PROMPT_KEY_ENCRYPTION_SECRET) {
    return {
      source: "SMART_PROMPT_KEY_ENCRYPTION_SECRET",
      value: process.env.SMART_PROMPT_KEY_ENCRYPTION_SECRET
    };
  }
  return {
    source: "local-install-fallback",
    value: `${dataDir}:${process.env.USERNAME || process.env.USER || "smart-prompt"}`
  };
}

function createCredentialVault(dataDir) {
  const vaultFile = path.join(dataDir, VAULT_FILE);
  let lastStorage = process.platform === "win32" ? "windows-dpapi" : "aes-256-gcm";

  function encrypt(text) {
    const dpapi = powershellDpapi("protect", text);
    if (dpapi) {
      lastStorage = "windows-dpapi";
      return { storage: "windows-dpapi", value: dpapi };
    }
    const secret = getFallbackSecret(dataDir);
    lastStorage = `aes-256-gcm:${secret.source}`;
    return {
      storage: "aes-256-gcm",
      keySource: secret.source,
      value: aesEncrypt(text, secret.value)
    };
  }

  function decrypt(record) {
    if (!record?.value) return "";
    if (record.storage === "windows-dpapi") {
      const decrypted = powershellDpapi("unprotect", record.value);
      lastStorage = "windows-dpapi";
      return decrypted ? Buffer.from(decrypted, "base64").toString("utf8") : "";
    }
    if (record.storage === "aes-256-gcm") {
      const secret = getFallbackSecret(dataDir);
      lastStorage = `aes-256-gcm:${secret.source}`;
      return aesDecrypt(record.value, secret.value);
    }
    return "";
  }

  function saveProviderKeys(providerKeys = {}) {
    const encrypted = {};
    for (const [provider, value] of Object.entries(providerKeys)) {
      if (!value) continue;
      encrypted[provider] = {
        ...encrypt(String(value)),
        length: String(value).length,
        sha256: hashValue(value)
      };
    }
    writeJson(vaultFile, {
      version: VAULT_VERSION,
      updated_at: new Date().toISOString(),
      keys: encrypted
    });
  }

  function loadProviderKeys() {
    const vault = readJson(vaultFile, {});
    const result = {};
    for (const [provider, record] of Object.entries(vault.keys || {})) {
      try {
        const value = decrypt(record);
        if (value) result[provider] = value;
      } catch {
        result[provider] = "";
      }
    }
    return result;
  }

  function getStorageSummary() {
    const vault = readJson(vaultFile, {});
    return {
      encrypted: true,
      storage: lastStorage,
      file: VAULT_FILE,
      providers: Object.keys(vault.keys || {}),
      plaintextSettings: false
    };
  }

  return {
    vaultFile,
    saveProviderKeys,
    loadProviderKeys,
    getStorageSummary
  };
}

module.exports = {
  VAULT_FILE,
  createCredentialVault
};
