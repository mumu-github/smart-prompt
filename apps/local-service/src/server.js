const http = require("node:http");
const { URL } = require("node:url");
const crypto = require("node:crypto");
const { buildCard, detectMode, rankSkills } = require("../../../packages/shared/smart-prompt-core");
const { generateWithConfiguredProvider, getProviderStatuses, redactKey } = require("../../../packages/shared/llm-gateway");
const { createStore, DEFAULT_PORT } = require("./store");
const { importSkillFolder } = require("./skill-library");
const { fillDesktopInput, getDesktopInputSnapshot } = require("./desktop-input-detector");

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  /^chrome-extension:\/\/[a-z]{32}$/i,
  /^moz-extension:\/\/[a-f0-9-]+$/i,
  /^safari-web-extension:\/\/[a-z0-9.-]+$/i,
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/localhost(?::\d+)?$/i
]);

const AUTH_HEADER = "Authorization";
const TOKEN_HEADER = "X-Smart-Prompt-Token";
const PUBLIC_ROUTES = new Set([
  "GET /health",
  "GET /auth/bootstrap"
]);

function normalizeAllowedOrigins(allowedOrigins = []) {
  return [...DEFAULT_ALLOWED_ORIGINS, ...allowedOrigins];
}

function isTrustedOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  return normalizeAllowedOrigins(allowedOrigins).some((allowed) => {
    if (typeof allowed === "string") return allowed === origin;
    if (allowed instanceof RegExp) return allowed.test(origin);
    return false;
  });
}

function createCorsHeaders(req, options = {}) {
  const origin = req?.headers?.origin || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": `Content-Type,${AUTH_HEADER},${TOKEN_HEADER}`,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Vary": "Origin"
  };
  if (origin && isTrustedOrigin(origin, options.allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function sendJson(req, res, status, value, options = {}) {
  res.writeHead(status, {
    ...createCorsHeaders(req, options)
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicSettings(settings) {
  const providerKeys = {};
  for (const [provider, value] of Object.entries(settings.providerKeys || {})) {
    providerKeys[provider] = value ? redactKey(value) : "";
  }
  return {
    ...settings,
    apiKey: settings.apiKey ? redactKey(settings.apiKey) : "",
    providerKeys,
    uploadWholePage: false,
    autoSubmit: false
  };
}

function routeKey(req, url) {
  return `${req.method} ${url.pathname}`;
}

function extractAuthToken(req) {
  const explicit = req.headers[TOKEN_HEADER.toLowerCase()];
  if (explicit) return String(explicit);
  const auth = req.headers[AUTH_HEADER.toLowerCase()] || "";
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req, store, options = {}) {
  if (options.disableAuth) return true;
  const expected = store.getAuthToken();
  const actual = extractAuthToken(req);
  return Boolean(expected && actual && secureEqual(actual, expected));
}

function createApp(store = createStore(), options = {}) {
  const generateWithLlm = options.generateWithLlm || generateWithConfiguredProvider;
  const desktopInputSnapshot = options.getDesktopInputSnapshot || getDesktopInputSnapshot;
  const desktopFill = options.fillDesktopInput || fillDesktopInput;

  return async function app(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");

    if (!isTrustedOrigin(req.headers.origin || "", options.allowedOrigins)) {
      sendJson(req, res, 403, {
        ok: false,
        error: {
          code: "origin_not_allowed",
          message: "Origin is not allowed for Smart Prompt local service."
        }
      }, options);
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 200, { ok: true }, options);
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(req, res, 200, {
          ok: true,
          service: "smart-prompt-local-service",
          version: "0.3.0",
          authRequired: true
        }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/auth/bootstrap") {
        sendJson(req, res, 200, {
          ok: true,
          auth: {
            scheme: "Bearer",
            header: AUTH_HEADER,
            tokenHeader: TOKEN_HEADER,
            token: store.getAuthToken()
          }
        }, options);
        return;
      }

      if (!PUBLIC_ROUTES.has(routeKey(req, url)) && !isAuthorized(req, store, options)) {
        sendJson(req, res, 401, {
          ok: false,
          error: {
            code: "auth_required",
            message: "Smart Prompt local service auth token is required."
          }
        }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/settings") {
        sendJson(req, res, 200, { ok: true, settings: publicSettings(store.getSettings()) }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/llm/providers") {
        sendJson(req, res, 200, { ok: true, ...getProviderStatuses(store.getSettings()) }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/llm/test") {
        const body = await readJson(req);
        const context = {
          host: "local",
          tool: "Smart Prompt",
          inputKind: "first-run-provider-test",
          pathKind: "local",
          mode: body.mode || "idea"
        };
        const input = "Generate a short Smart Prompt provider connectivity check.";
        const skills = rankSkills(input, context, store.getSkills(), 3);
        const settings = store.getSettings();
        try {
          const card = await generateWithLlm({
            input,
            context,
            skills,
            variantIndex: 0,
            settings
          });
          sendJson(req, res, 200, {
            ok: true,
            provider: card.provider || settings.provider,
            model: card.model || settings.model,
            mode: card.mode || context.mode,
            generatedBy: card.generatedBy || "llm",
            promptLength: String(card.prompt || "").length,
            skillCount: skills.length,
            uploadWholePage: false,
            autoSubmit: false,
            testedAt: new Date().toISOString()
          }, options);
        } catch (error) {
          sendJson(req, res, 502, {
            ok: false,
            error: {
              code: error.code || "llm_test_failed",
              message: error.message
            }
          }, options);
        }
        return;
      }

      if (req.method === "PUT" && url.pathname === "/settings") {
        const body = await readJson(req);
        const settings = store.saveSettings(body.settings || body);
        sendJson(req, res, 200, { ok: true, settings: publicSettings(settings) }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/skills") {
        sendJson(req, res, 200, { ok: true, skills: store.getSkills() }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/prompts") {
        sendJson(req, res, 200, { ok: true, prompts: store.getPrompts() }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/search") {
        const query = url.searchParams.get("q") || "";
        const kind = url.searchParams.get("kind") || "all";
        sendJson(req, res, 200, {
          ok: true,
          queryLength: query.length,
          prompts: kind === "skills" ? [] : store.searchPrompts(query),
          skills: kind === "prompts" ? [] : store.searchSkills(query)
        }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/prompts") {
        const body = await readJson(req);
        const promptBody = body.body || body.prompt || "";
        if (!String(promptBody).trim()) {
          sendJson(req, res, 400, { ok: false, error: { code: "empty_prompt", message: "Prompt body is required." } }, options);
          return;
        }
        const prompts = store.addPrompt({ ...body, body: promptBody });
        sendJson(req, res, 200, { ok: true, prompt: prompts[0], prompts }, options);
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/prompts/")) {
        const id = decodeURIComponent(url.pathname.slice("/prompts/".length));
        const deleted = store.deletePrompt(id);
        sendJson(req, res, deleted ? 200 : 404, deleted
          ? { ok: true, prompts: store.getPrompts() }
          : { ok: false, error: { code: "prompt_not_found", message: "Prompt not found." } }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/skills/import-folder") {
        const body = await readJson(req);
        const imported = importSkillFolder(body.path);
        const skills = store.addSkills(imported);
        sendJson(req, res, 200, { ok: true, imported, skills }, options);
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/skills/")) {
        const id = decodeURIComponent(url.pathname.slice("/skills/".length));
        const deleted = store.deleteSkill(id);
        sendJson(req, res, deleted ? 200 : 404, deleted
          ? { ok: true, skills: store.getSkills() }
          : { ok: false, error: { code: "skill_not_found", message: "Skill not found." } }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/skills/recommend") {
        const body = await readJson(req);
        const skills = rankSkills(body.input || "", body.context || {}, store.getSkills(), 3);
        sendJson(req, res, 200, { ok: true, skills }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/data/backup") {
        sendJson(req, res, 200, { ok: true, backup: store.exportData() }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/data/restore") {
        const body = await readJson(req);
        const restored = store.restoreData(body.backup || body);
        sendJson(req, res, 200, { ok: true, restored }, options);
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/data/all") {
        const deleted = store.clearAllLocalData();
        sendJson(req, res, 200, { ok: true, deleted, clearAllLocalData: true }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/diagnostics/export") {
        sendJson(req, res, 200, { ok: true, diagnostics: store.exportDiagnostics() }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/desktop/input-snapshot") {
        const selfTest = url.searchParams.get("selfTest") === "1";
        const snapshot = await desktopInputSnapshot({ selfTest });
        sendJson(req, res, 200, { ok: true, snapshot }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/fill") {
        const body = await readJson(req);
        const selfTest = url.searchParams.get("selfTest") === "1" || body.selfTest === true;
        const confirmForeground = url.searchParams.get("confirmForeground") === "1" || body.confirmForeground === true;
        const fill = await desktopFill({
          selfTest,
          confirmForeground,
          expectedTitleHash: body.expectedTitleHash || "",
          expectedToolProfile: body.expectedToolProfile || "",
          candidateIndex: Number.isFinite(Number(body.candidateIndex)) ? Number(body.candidateIndex) : 0,
          text: body.text || body.prompt || ""
        });
        sendJson(req, res, 200, { ok: true, fill }, options);
        return;
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        sendJson(req, res, 200, { ok: true, metrics: store.getMetrics() }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/metrics") {
        const body = await readJson(req);
        const metrics = store.recordMetric(body.event || body);
        sendJson(req, res, 200, { ok: true, metric: metrics[0], metrics: store.getMetrics() }, options);
        return;
      }

      if (req.method === "POST" && url.pathname === "/generate") {
        const body = await readJson(req);
        const context = {
          ...(body.context || {}),
          mode: body.mode || body.context?.mode || detectMode(body.input || "")
        };
        const skills = rankSkills(body.input || "", context, store.getSkills(), 3);
        const settings = store.getSettings();
        let card;
        try {
          card = await generateWithLlm({
            input: body.input || "",
            context,
            skills,
            variantIndex: body.variantIndex || 0,
            settings
          });
        } catch (error) {
          if (body.allowTemplateFallback === true) {
            card = {
              ...buildCard(body.input || "", context, skills, body.variantIndex || 0),
              generatedBy: "template-fallback",
              error: {
                code: error.code || "llm_error",
                message: error.message
              }
            };
          } else {
            sendJson(req, res, 502, {
              ok: false,
              error: {
                code: error.code || "llm_error",
                message: error.message
              }
            }, options);
            return;
          }
        }

        store.addPromptHistory({
          id: `prompt-${Date.now()}`,
          created_at: new Date().toISOString(),
          mode: card.mode,
          tool: card.tool,
          generatedBy: card.generatedBy,
          context: {
            host: context.host,
            inputKind: context.inputKind
          }
        });
        sendJson(req, res, 200, { ok: true, card }, options);
        return;
      }

      sendJson(req, res, 404, { ok: false, error: { code: "not_found", message: `${req.method} ${url.pathname}` } }, options);
    } catch (error) {
      sendJson(req, res, 500, { ok: false, error: { code: error.code || "server_error", message: error.message } }, options);
    }
  };
}

function startServer({
  port = Number(process.env.SMART_PROMPT_PORT || DEFAULT_PORT),
  store = createStore(),
  generateWithLlm,
  getDesktopInputSnapshot: desktopInputSnapshot,
  fillDesktopInput: desktopFill,
  allowedOrigins = [],
  disableAuth = false
} = {}) {
  const server = http.createServer(createApp(store, { generateWithLlm, getDesktopInputSnapshot: desktopInputSnapshot, fillDesktopInput: desktopFill, allowedOrigins, disableAuth }));
  server.listen(port, "127.0.0.1");
  return server;
}

if (require.main === module) {
  const server = startServer();
  server.once("listening", () => {
    const address = server.address();
    console.log(`Smart Prompt local service listening on http://127.0.0.1:${address.port}`);
  });
}

module.exports = {
  AUTH_HEADER,
  DEFAULT_ALLOWED_ORIGINS,
  TOKEN_HEADER,
  createApp,
  extractAuthToken,
  isTrustedOrigin,
  readJson,
  sendJson,
  startServer
};
