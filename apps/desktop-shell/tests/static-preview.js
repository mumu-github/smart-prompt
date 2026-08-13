const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(root, urlPath.replace(/^\//, ""));
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200);
  res.end(fs.readFileSync(filePath));
});

const port = Number(process.env.SMART_PROMPT_PREVIEW_PORT || 17372);
server.listen(port, "127.0.0.1", () => {
  console.log(`Desktop shell static preview: http://127.0.0.1:${port}`);
});
