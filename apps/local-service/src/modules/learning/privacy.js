"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const contracts = require("../../../../../packages/outcome-learning");

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,179}$/;
const FORBIDDEN_INPUT_FIELDS = new Set([
  "rawinput",
  "originalinput",
  "inputtext",
  "generatedprompt",
  "prompttext",
  "rawprompt",
  "chat",
  "chatcontent",
  "chattext",
  "clipboard",
  "clipboardcontent",
  "clipboardtext",
  "title",
  "windowtitle",
  "rawtitle",
  "path",
  "projectpath",
  "absoluteprojectpath",
  "absolutepath",
  "apikey",
  "credential",
  "secret",
  "rawevidence"
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertOpaqueToken(value, fieldName = "token") {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw codedError("invalid_learning_token", `${fieldName} must be a bounded opaque token.`);
  }
  return value;
}

function assertTokenArray(value, fieldName, { minLength = 0, maxLength = 64 } = {}) {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    throw codedError("invalid_learning_token", `${fieldName} must contain ${minLength}-${maxLength} opaque tokens.`);
  }
  const normalized = value.map((item, index) => assertOpaqueToken(item, `${fieldName}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw codedError("invalid_learning_token", `${fieldName} must not contain duplicate tokens.`);
  }
  return normalized;
}

function compactFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findForbiddenInputFields(value, currentPath = "$") {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findForbiddenInputFields(item, `${currentPath}[${index}]`)));
    return violations;
  }
  if (!value || typeof value !== "object") return violations;
  for (const [key, item] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    if (FORBIDDEN_INPUT_FIELDS.has(compactFieldName(key))) violations.push(childPath);
    violations.push(...findForbiddenInputFields(item, childPath));
  }
  return violations;
}

function assertPrivacySafeInput(value) {
  const forbiddenFields = findForbiddenInputFields(value);
  const contractViolations = contracts.findPrivacyViolations(value);
  if (forbiddenFields.length > 0 || contractViolations.length > 0) {
    const error = codedError("privacy_input_rejected", "Raw or sensitive learning input cannot cross the persistence boundary.");
    error.violations = [
      ...forbiddenFields.map((fieldPath) => ({ code: "privacy_forbidden_field", path: fieldPath })),
      ...contractViolations.map(({ code, path: violationPath }) => ({ code, path: violationPath }))
    ];
    throw error;
  }
}

function canonicalFeatureTokens(value) {
  return [...assertTokenArray(value, "featureTokens", { minLength: 1, maxLength: 64 })].sort();
}

function createRandomBytesSource(options = {}) {
  if (typeof options.randomBytes === "function") {
    return (size) => {
      const value = Buffer.from(options.randomBytes(size));
      if (value.length !== size) throw codedError("invalid_random_source", `randomBytes must return exactly ${size} bytes.`);
      return value;
    };
  }
  if (typeof options.random === "function") {
    return (size) => {
      const value = Buffer.alloc(size);
      for (let index = 0; index < size; index += 1) {
        const sample = Number(options.random());
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
          throw codedError("invalid_random_source", "random must return a finite number in [0, 1)." );
        }
        value[index] = Math.floor(sample * 256);
      }
      return value;
    };
  }
  return (size) => crypto.randomBytes(size);
}

function projectTokenFileStem(projectScopeToken) {
  return Buffer.from(assertOpaqueToken(projectScopeToken, "projectScopeToken"), "utf8").toString("base64url");
}

function createProjectHmacKeys(dataDir, randomBytes) {
  const keysDir = path.join(dataDir, "learning-keys");

  function keyFile(projectScopeToken) {
    return path.join(keysDir, `${projectTokenFileStem(projectScopeToken)}.hmac.key`);
  }

  function readKey(file) {
    const encoded = fs.readFileSync(file, "utf8").trim();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw codedError("invalid_project_hmac_key", "The project HMAC key file is invalid and was not replaced.");
    }
    return key;
  }

  function loadOrCreateKey(projectScopeToken) {
    const file = keyFile(projectScopeToken);
    if (fs.existsSync(file)) return readKey(file);
    fs.mkdirSync(keysDir, { recursive: true });
    const key = randomBytes(32);
    try {
      fs.writeFileSync(file, `${key.toString("base64")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      return key;
    } catch (error) {
      if (error?.code === "EEXIST") return readKey(file);
      throw error;
    }
  }

  function fingerprint(projectScopeToken, featureTokens, { create = true } = {}) {
    const file = keyFile(projectScopeToken);
    if (!create && !fs.existsSync(file)) return null;
    const key = create ? loadOrCreateKey(projectScopeToken) : readKey(file);
    const canonical = canonicalFeatureTokens(featureTokens);
    return crypto
      .createHmac("sha256", key)
      .update(JSON.stringify(canonical), "utf8")
      .digest("hex");
  }

  function archiveKey(projectScopeToken, archiveDir) {
    const source = keyFile(projectScopeToken);
    if (!fs.existsSync(source)) return false;
    fs.mkdirSync(archiveDir, { recursive: true });
    const destination = path.join(archiveDir, "project-hmac.key");
    if (fs.existsSync(destination)) {
      throw codedError("learning_archive_conflict", "The recoverable archive already contains a project HMAC key.");
    }
    fs.renameSync(source, destination);
    return true;
  }

  return {
    archiveKey,
    fingerprint,
    keyFile
  };
}

module.exports = {
  TOKEN_PATTERN,
  assertOpaqueToken,
  assertPrivacySafeInput,
  assertTokenArray,
  canonicalFeatureTokens,
  codedError,
  createProjectHmacKeys,
  createRandomBytesSource
};
