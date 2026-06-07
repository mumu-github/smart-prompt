(function initSmartPromptLocalService(root) {
  const DEFAULT_SERVICE_URL = "http://127.0.0.1:17371";
  const authTokens = new Map();

  function normalizeServiceUrl(serviceUrl) {
    return (serviceUrl || DEFAULT_SERVICE_URL).replace(/\/$/, "");
  }

  function needsAuth(path) {
    return path !== "/health" && path !== "/auth/bootstrap";
  }

  async function bootstrapAuth(base) {
    const response = await fetch(`${base}/auth/bootstrap`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });
    const body = await response.json();
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
    const body = await response.json();
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

  function health(serviceUrl) {
    return request("/health", { method: "GET" }, serviceUrl);
  }

  function auth(serviceUrl) {
    return request("/auth/bootstrap", { method: "GET" }, serviceUrl);
  }

  function generate(payload, serviceUrl) {
    return request("/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  function recommend(payload, serviceUrl) {
    return request("/skills/recommend", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  function savePrompt(payload, serviceUrl) {
    return request("/prompts", {
      method: "POST",
      body: JSON.stringify(payload)
    }, serviceUrl);
  }

  const api = {
    DEFAULT_SERVICE_URL,
    auth,
    generate,
    health,
    recommend,
    savePrompt
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptLocalService = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
