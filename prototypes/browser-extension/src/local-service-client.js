(function initSmartPromptLocalService(root) {
  const DEFAULT_SERVICE_URL = "http://127.0.0.1:17371";
  const ACTIVATION_CONTRACT_VERSION = "phase3-activation@1";
  const authTokens = new Map();

  function normalizeServiceUrl(serviceUrl) {
    return (serviceUrl || DEFAULT_SERVICE_URL).replace(/\/$/, "");
  }

  function needsAuth(path) {
    return path !== "/health" && path !== "/auth/bootstrap";
  }

  function hasExtensionBridge() {
    return Boolean(root.chrome?.runtime?.sendMessage && root.chrome?.runtime?.id);
  }

  async function bootstrapAuth(base) {
    const response = await fetch(`${base}/auth/bootstrap`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await parseJsonResponse(response, "/auth/bootstrap");
    if (!response.ok || body.ok === false || !body.auth?.token) {
      const error = new Error(body?.error?.message || `Local service auth failed: ${response.status}`);
      error.code = body?.error?.code || "local_service_auth_error";
      error.status = response.status;
      throw error;
    }
    authTokens.set(base, body.auth.token);
    return body.auth.token;
  }

  async function getAuthToken(base) {
    return authTokens.get(base) || bootstrapAuth(base);
  }

  async function request(path, options, serviceUrl, retrying = false) {
    const base = normalizeServiceUrl(serviceUrl);
    const token = needsAuth(path) ? await getAuthToken(base) : "";
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers || {})
      }
    });
    const body = await parseJsonResponse(response, path);
    if (response.status === 401 && needsAuth(path) && !retrying) {
      authTokens.delete(base);
      return request(path, options, serviceUrl, true);
    }
    if (!response.ok || body.ok === false) {
      const error = new Error(body?.error?.message || `Local service request failed: ${response.status}`);
      error.code = body?.error?.code || "local_service_error";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function parseJsonResponse(response, path) {
    const text = await response.text();
    if (!text.trim()) {
      if (response.ok) return {};
      const error = new Error(`Local service ${path} returned empty response: ${response.status}`);
      error.code = "local_service_empty_response";
      error.status = response.status;
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (parseError) {
      const error = new Error(`Local service ${path} returned non-JSON: ${response.status} ${text.slice(0, 200)}`);
      error.code = "local_service_non_json_response";
      error.status = response.status;
      error.cause = parseError;
      throw error;
    }
  }

  function health(serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/health", "GET", null, serviceUrl);
    return request("/health", { method: "GET" }, serviceUrl);
  }

  function auth(serviceUrl) {
    if (hasExtensionBridge()) {
      const error = new Error("Authentication bootstrap is internal to the browser bridge.");
      error.code = "local_service_auth_internal";
      return Promise.reject(error);
    }
    return request("/auth/bootstrap", { method: "GET" }, serviceUrl);
  }

  function generate(payload, serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/generate", "POST", payload, serviceUrl);
    return request("/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  function recommend(payload, serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/skills/recommend", "POST", payload, serviceUrl);
    return request("/skills/recommend", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  function savePrompt(payload, serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/prompts", "POST", payload, serviceUrl);
    return request("/prompts", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  function recordMetric(payload, serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/metrics", "POST", { event: payload }, serviceUrl);
    return request("/metrics", {
      method: "POST",
      body: JSON.stringify({ event: payload })
    }, serviceUrl);
  }

  function getActivationStatus(serviceUrl) {
    if (hasExtensionBridge()) return bridgeServiceRequest("/activation/status", "GET", null, serviceUrl);
    return request("/activation/status", { method: "GET" }, serviceUrl);
  }

  function markActivationBrowserSeen(payload, serviceUrl) {
    const activationPayload = {
      contractVersion: payload?.contractVersion || ACTIVATION_CONTRACT_VERSION,
      site: payload?.site || "chatgpt",
      seenAt: payload?.seenAt || ""
    };
    if (hasExtensionBridge()) {
      return bridgeActivationRequest("browser-seen", activationPayload, serviceUrl);
    }
    return request("/activation/browser-seen", {
      method: "POST",
      body: JSON.stringify(activationPayload)
    }, serviceUrl);
  }

  function completeActivation(payload, serviceUrl) {
    const activationPayload = {
      contractVersion: payload?.contractVersion || ACTIVATION_CONTRACT_VERSION,
      eventId: payload?.eventId || "",
      site: payload?.site || "chatgpt",
      completionKind: payload?.completionKind || "",
      targetKind: payload?.targetKind || "",
      extensionBuildId: payload?.extensionBuildId || "",
      stableReadback: payload?.stableReadback === true,
      verified: payload?.verified === true,
      copied: payload?.copied === true
    };
    if (hasExtensionBridge()) {
      return bridgeActivationRequest("complete", activationPayload, serviceUrl);
    }
    return request("/activation/complete", {
      method: "POST",
      body: JSON.stringify(activationPayload)
    }, serviceUrl);
  }

  function bridgeActivationRequest(action, payload, serviceUrl) {
    return new Promise((resolve, reject) => {
      root.chrome.runtime.sendMessage({
        type: "smart-prompt-activation",
        action,
        payload,
        serviceUrl: normalizeServiceUrl(serviceUrl)
      }, (response) => {
        const runtimeError = root.chrome.runtime.lastError;
        if (runtimeError) {
          const error = new Error(runtimeError.message || "Activation bridge unavailable.");
          error.code = "activation_bridge_unavailable";
          reject(error);
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error?.message || "Activation request failed.");
          error.code = response?.error?.code || "activation_request_failed";
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  function bridgeServiceRequest(path, method, body, serviceUrl) {
    return new Promise((resolve, reject) => {
      root.chrome.runtime.sendMessage({
        type: "smart-prompt-service-request",
        path,
        method,
        body,
        serviceUrl: normalizeServiceUrl(serviceUrl)
      }, (response) => {
        const runtimeError = root.chrome.runtime.lastError;
        if (runtimeError) {
          const error = new Error(runtimeError.message || "Local service bridge unavailable.");
          error.code = "local_service_bridge_unavailable";
          reject(error);
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error?.message || "Local service request failed.");
          error.code = response?.error?.code || "local_service_error";
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  const api = {
    DEFAULT_SERVICE_URL,
    auth,
    completeActivation,
    generate,
    getActivationStatus,
    health,
    markActivationBrowserSeen,
    recordMetric,
    recommend,
    savePrompt
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptLocalService = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
