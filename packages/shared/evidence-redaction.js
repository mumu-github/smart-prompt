const { hashTextSha } = require("./utils");

const TEXT_KEY_PATTERN = /^(prompt|body|bodyPreview|input|output|value|beforeValue|title|pageTitle|text|content)$/i;
const PATH_KEY_PATTERN = /(profileDir|profilePath|userDataDir|dataDir|path)$/i;
const URL_KEY_PATTERN = /^(url|href)$/i;

function normalizeKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isSecretKey(key) {
  const normalized = normalizeKey(key);
  return [
    "api_key",
    "auth_token",
    "authorization",
    "bearer",
    "provider_key",
    "provider_keys",
    "token",
    "secret",
    "password"
  ].includes(normalized) || normalized.endsWith("_api_key") || normalized.endsWith("_auth_token");
}

function hashValue(value) {
  return hashTextSha(value);
}

function pathKindFromUrl(url) {
  const segments = url.pathname.split("/").filter(Boolean).length;
  if (segments === 0) return "root";
  if (segments === 1) return "one-segment";
  return "multi-segment";
}

function summarizeText(value, label = "REDACTED_TEXT") {
  return {
    redacted: label,
    length: String(value || "").length,
    sha256: hashValue(value)
  };
}

function summarizeUrl(value) {
  try {
    const url = new URL(String(value));
    return {
      redacted: "REDACTED_URL",
      origin: url.origin,
      pathKind: pathKindFromUrl(url),
      queryPresent: Boolean(url.search),
      sha256: hashValue(value)
    };
  } catch {
    return summarizeText(value, "REDACTED_URL");
  }
}

function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED_TOKEN]")
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, "sk-[REDACTED]")
    .replace(/AIza[A-Za-z0-9._-]{8,}/g, "AIza[REDACTED]");
}

function redactEvidence(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redactEvidence(item, key));
  }

  if (value && typeof value === "object") {
    const next = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      next[childKey] = redactEvidence(childValue, childKey);
    }
    return next;
  }

  if (value === null || value === undefined) return value;

  if (isSecretKey(key)) {
    return value ? "[REDACTED_SECRET]" : value;
  }
  if (PATH_KEY_PATTERN.test(key)) {
    return value ? summarizeText(value, "REDACTED_PATH") : value;
  }
  if (URL_KEY_PATTERN.test(key)) {
    return value ? summarizeUrl(value) : value;
  }
  if (TEXT_KEY_PATTERN.test(key) && typeof value === "string") {
    return value ? summarizeText(value) : value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  return value;
}

function collectRedactionLeaks(value, path = "$", leaks = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRedactionLeaks(item, `${path}[${index}]`, leaks));
    return leaks;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectRedactionLeaks(child, `${path}.${key}`, leaks);
    }
    return leaks;
  }
  if (typeof value !== "string") return leaks;
  const patterns = [
    /Bearer\s+(?!\[REDACTED_TOKEN\])/,
    /sk-[A-Za-z0-9._-]{8,}/,
    /AIza[A-Za-z0-9._-]{8,}/,
    /https?:\/\/[^\s"]+\?.+/,
    /C:\\Users\\[^"'\n\r]+/i
  ];
  for (const pattern of patterns) {
    if (pattern.test(value)) leaks.push({ path, pattern: String(pattern), preview: value.slice(0, 80) });
  }
  return leaks;
}

module.exports = {
  collectRedactionLeaks,
  hashValue,
  isSecretKey,
  redactEvidence,
  summarizeText,
  summarizeUrl
};
