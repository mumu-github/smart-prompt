const http = require("node:http");
const { URL } = require("node:url");
const { buildCard, detectMode, rankSkills } = require("../../../packages/shared/smart-prompt-core");
const { generateWithConfiguredProvider, redactKey } = require("../../../packages/shared/llm-gateway");
const { createStore, DEFAULT_PORT } = require("./store");
const { importSkillFolder } = require("./skill-library");

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
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
  return {
    ...settings,
    apiKey: settings.apiKey ? redactKey(settings.apiKey) : "",
    uploadWholePage: false,
    autoSubmit: false
  };
}

function createApp(store = createStore(), options = {}) {
  const generateWithLlm = options.generateWithLlm || generateWithConfiguredProvider;

  return async function app(req, res) {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "smart-prompt-local-service", version: "0.2.0" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/settings") {
        sendJson(res, 200, { ok: true, settings: publicSettings(store.getSettings()) });
        return;
      }

      if (req.method === "PUT" && url.pathname === "/settings") {
        const body = await readJson(req);
        const settings = store.saveSettings(body.settings || body);
        sendJson(res, 200, { ok: true, settings: publicSettings(settings) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/skills") {
        sendJson(res, 200, { ok: true, skills: store.getSkills() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/prompts") {
        sendJson(res, 200, { ok: true, prompts: store.getPrompts() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/prompts") {
        const body = await readJson(req);
        const promptBody = body.body || body.prompt || "";
        if (!String(promptBody).trim()) {
          sendJson(res, 400, { ok: false, error: { code: "empty_prompt", message: "Prompt body is required." } });
          return;
        }
        const prompts = store.addPrompt({ ...body, body: promptBody });
        sendJson(res, 200, { ok: true, prompt: prompts[0], prompts });
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/prompts/")) {
        const id = decodeURIComponent(url.pathname.slice("/prompts/".length));
        const deleted = store.deletePrompt(id);
        sendJson(res, deleted ? 200 : 404, deleted
          ? { ok: true, prompts: store.getPrompts() }
          : { ok: false, error: { code: "prompt_not_found", message: "Prompt not found." } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/skills/import-folder") {
        const body = await readJson(req);
        const imported = importSkillFolder(body.path);
        const skills = store.addSkills(imported);
        sendJson(res, 200, { ok: true, imported, skills });
        return;
      }

      if (req.method === "POST" && url.pathname === "/skills/recommend") {
        const body = await readJson(req);
        const skills = rankSkills(body.input || "", body.context || {}, store.getSkills(), 3);
        sendJson(res, 200, { ok: true, skills });
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
            settings: {
              ...settings,
              apiKey: settings.apiKey || process.env.OPENAI_API_KEY
            }
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
            sendJson(res, 502, {
              ok: false,
              error: {
                code: error.code || "llm_error",
                message: error.message
              }
            });
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
        sendJson(res, 200, { ok: true, card });
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: "not_found", message: `${req.method} ${url.pathname}` } });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: { code: error.code || "server_error", message: error.message } });
    }
  };
}

function startServer({
  port = Number(process.env.SMART_PROMPT_PORT || DEFAULT_PORT),
  store = createStore(),
  generateWithLlm
} = {}) {
  const server = http.createServer(createApp(store, { generateWithLlm }));
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
  createApp,
  readJson,
  sendJson,
  startServer
};
