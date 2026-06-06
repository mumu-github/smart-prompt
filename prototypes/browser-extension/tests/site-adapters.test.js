const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const adapters = require("../src/site-adapters.js");

assert.ok(adapters.SITE_ADAPTERS.length >= 8);
for (const id of ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"]) {
  const adapter = adapters.SITE_ADAPTERS.find((item) => item.id === id);
  assert.ok(adapter, `missing adapter ${id}`);
  assert.ok(adapter.inputSelectors.length >= 1);
}

assert.equal(adapters.detectSiteAdapter("chatgpt.com").id, "chatgpt");
assert.equal(adapters.detectSiteAdapter("claude.ai").id, "claude");
assert.equal(adapters.detectSiteAdapter("gemini.google.com").id, "gemini");

const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
assert.ok(content.includes("localService.generate"));
assert.ok(content.includes("allowTemplateFallback"));
assert.ok(!/submit\s*\(/.test(content));
assert.ok(!/KeyboardEvent\([^)]*Enter/.test(content));

console.log("site-adapters tests passed");
