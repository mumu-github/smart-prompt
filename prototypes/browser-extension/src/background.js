(function initSmartPromptActivationBridge() {
  const DEFAULT_SERVICE_URL = "http://127.0.0.1:17371";
  const DEFAULT_SERVICE_PORT = "17371";
  const ACTIVATION_CONTRACT_VERSION = "phase3-activation@1";
  const REQUIRED_EXTENSION_BUILD_ID = "phase3-extension-20260717-r5";
  const ACTIVATION_EVENT_ID_PATTERN = /^activation-(?:verified_insert|copy)-\d{10,16}$/;
  const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const SERVICE_ROUTES = Object.freeze({
    "GET /health": true,
    "GET /activation/status": true,
    "POST /generate": true,
    "POST /skills/recommend": true,
    "POST /prompts": true,
    "POST /metrics": true
  });
  const authTokens = new Map();

  function normalizeServiceUrl(value) {
    try {
      const parsed = new URL(value || DEFAULT_SERVICE_URL);
      if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) return DEFAULT_SERVICE_URL;
      if (parsed.protocol !== "http:") return DEFAULT_SERVICE_URL;
      if (parsed.port && parsed.port !== DEFAULT_SERVICE_PORT) return DEFAULT_SERVICE_URL;
      return `${parsed.origin}`;
    } catch {
      return DEFAULT_SERVICE_URL;
    }
  }

  async function readJson(response, path) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(`Local service ${path} returned non-JSON.`);
      error.code = "local_service_non_json_response";
      throw error;
    }
  }

  async function getToken(serviceUrl) {
    const cached = authTokens.get(serviceUrl);
    if (cached) return cached;
    const response = await fetch(`${serviceUrl}/auth/bootstrap`, { method: "GET" });
    const body = await readJson(response, "/auth/bootstrap");
    if (!response.ok || !body.auth?.token) {
      const error = new Error(body.error?.message || "Local service authentication failed.");
      error.code = body.error?.code || "local_service_auth_error";
      throw error;
    }
    authTokens.set(serviceUrl, body.auth.token);
    return body.auth.token;
  }

  function isChatGptSender(sender) {
    try {
      const url = new URL(sender?.tab?.url || sender?.url || "");
      return CHATGPT_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }

  function isHttpTabSender(sender) {
    if (sender?.tab?.id === undefined) return false;
    try {
      const url = new URL(sender.tab.url || sender.url || "");
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function normalizeActivationPayload(action, payload = {}) {
    if (action === "browser-seen") {
      const seenAt = String(payload.seenAt || "").trim();
      return {
        contractVersion: ACTIVATION_CONTRACT_VERSION,
        site: payload.site === "chatgpt" ? "chatgpt" : "",
        seenAt: ISO_TIMESTAMP_PATTERN.test(seenAt) && !Number.isNaN(Date.parse(seenAt)) ? seenAt : ""
      };
    }
    if (action === "complete") {
      const eventId = String(payload.eventId || "").trim().toLowerCase();
      return {
        contractVersion: ACTIVATION_CONTRACT_VERSION,
        eventId: ACTIVATION_EVENT_ID_PATTERN.test(eventId) ? eventId : "",
        site: payload.site === "chatgpt" ? "chatgpt" : "",
        completionKind: payload.completionKind === "verified_insert" || payload.completionKind === "copy"
          ? payload.completionKind
          : "",
        targetKind: payload.targetKind === "chatgpt-composer" ? "chatgpt-composer" : "",
        extensionBuildId: payload.extensionBuildId === REQUIRED_EXTENSION_BUILD_ID
          ? REQUIRED_EXTENSION_BUILD_ID
          : "",
        stableReadback: payload.stableReadback === true,
        verified: payload.verified === true,
        copied: payload.copied === true
      };
    }
    return null;
  }

  async function handleActivationMessage(message, sender) {
    if (!isChatGptSender(sender)) {
      return { ok: false, error: { code: "activation_sender_not_chatgpt", message: "Activation requires a ChatGPT tab." } };
    }
    const payload = normalizeActivationPayload(message.action, message.payload);
    if (!payload?.site) {
      return { ok: false, error: { code: "activation_payload_invalid", message: "Activation payload is invalid." } };
    }
    const serviceUrl = normalizeServiceUrl(message.serviceUrl);
    try {
      const token = await getToken(serviceUrl);
      const path = message.action === "browser-seen" ? "/activation/browser-seen" : "/activation/complete";
      const response = await fetch(`${serviceUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response, path);
      if (response.status === 401) {
        authTokens.delete(serviceUrl);
      }
      return body;
    } catch (error) {
      return { ok: false, error: { code: error.code || "activation_bridge_failed", message: error.message } };
    }
  }

  async function handleServiceMessage(message, sender) {
    if (!isHttpTabSender(sender)) {
      return { ok: false, error: { code: "service_sender_invalid", message: "Local service access requires an extension tab." } };
    }
    const method = String(message.method || "GET").toUpperCase();
    const path = String(message.path || "");
    if (!SERVICE_ROUTES[`${method} ${path}`]) {
      return { ok: false, error: { code: "service_route_not_allowed", message: "This local service route is not available to the browser bridge." } };
    }
    const serviceUrl = normalizeServiceUrl(message.serviceUrl);
    const requestBody = method === "GET" ? undefined : JSON.stringify(message.body || {});
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const token = await getToken(serviceUrl);
        const response = await fetch(`${serviceUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          ...(requestBody === undefined ? {} : { body: requestBody })
        });
        const body = await readJson(response, path);
        if (response.status === 401) {
          authTokens.delete(serviceUrl);
          if (attempt === 0) continue;
        }
        return body;
      } catch (error) {
        return { ok: false, error: { code: error.code || "local_service_bridge_failed", message: error.message } };
      }
    }
    return { ok: false, error: { code: "local_service_auth_error", message: "Local service authentication failed." } };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "smart-prompt-activation") {
      handleActivationMessage(message, sender).then(sendResponse);
      return true;
    }
    if (message?.type === "smart-prompt-service-request") {
      handleServiceMessage(message, sender).then(sendResponse);
      return true;
    }
    return false;
  });
})();
