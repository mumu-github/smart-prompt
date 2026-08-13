const http = require("node:http");

const port = Number(process.env.SYNTHETIC_PROVIDER_PORT || 17373);
const response = {
  id: "synthetic-activation-qa",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Synthetic QA output: produce a concise, actionable answer with clear assumptions."
      },
      finish_reason: "stop"
    }
  ]
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, provider: "synthetic-local" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not_found" } }));
    return;
  }
  for await (const _chunk of req) {
    // Consume the request body without retaining the prompt or other input.
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
});

server.listen(port, "127.0.0.1");
