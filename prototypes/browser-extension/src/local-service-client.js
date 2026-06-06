(function initSmartPromptLocalService(root) {
  const DEFAULT_SERVICE_URL = "http://127.0.0.1:17371";

  async function request(path, options, serviceUrl) {
    const base = (serviceUrl || DEFAULT_SERVICE_URL).replace(/\/$/, "");
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {})
      }
    });
    const body = await response.json();
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

  const api = {
    DEFAULT_SERVICE_URL,
    generate,
    health,
    recommend
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SmartPromptLocalService = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
