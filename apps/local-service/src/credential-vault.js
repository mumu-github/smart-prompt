const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, hashTextSha, readJson, writeJson } = require("../../../packages/shared/utils");

const VAULT_FILE = "provider-keys.json";
const KEY_SECRET_FILE = "key-secret.json";
const VAULT_VERSION = 1;

function hashValue(value) {
  return hashTextSha(value);
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
  const secretFile = path.join(dataDir, KEY_SECRET_FILE);
  const existing = readJson(secretFile, {});
  if (existing?.secret) {
    return {
      source: "machine-random-key-file",
      value: existing.secret
    };
  }
  const record = {
    version: 1,
    created_at: new Date().toISOString(),
    secret: crypto.randomBytes(32).toString("hex")
  };
  writeJson(secretFile, record);
  try {
    fs.chmodSync(secretFile, 0o600);
  } catch {
    // Best effort on Windows and restricted filesystems; the secret remains per-machine random.
  }
  return {
    source: "machine-random-key-file",
    value: record.secret
  };
}

function getLegacyFallbackSecret(dataDir) {
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
      try {
        return aesDecrypt(record.value, secret.value);
      } catch (error) {
        if (record.keySource !== "local-install-fallback") throw error;
        const legacySecret = getLegacyFallbackSecret(dataDir);
        lastStorage = `aes-256-gcm:${legacySecret.source}`;
        return aesDecrypt(record.value, legacySecret.value);
      }
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
