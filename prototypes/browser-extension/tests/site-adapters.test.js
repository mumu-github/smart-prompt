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
const expectedInsertStrategies = {
  chatgpt: "contenteditable-or-textarea",
  claude: "contenteditable-or-textarea",
  gemini: "contenteditable"
};
for (const [id, strategy] of Object.entries(expectedInsertStrategies)) {
  const adapter = adapters.SITE_ADAPTERS.find((item) => item.id === id);
  assert.equal(adapter.insertStrategy, strategy, `${id} insert strategy changed`);
}

assert.equal(adapters.detectSiteAdapter("chatgpt.com").id, "chatgpt");
assert.equal(adapters.detectSiteAdapter("claude.ai").id, "claude");
assert.equal(adapters.detectSiteAdapter("gemini.google.com").id, "gemini");
assert.equal(adapters.detectSiteAdapter("v0.app").id, "v0");

const lightInput = { id: "light" };
const shadowInput = { id: "shadow" };
const shadowRoot = {
  querySelectorAll(selector) {
    if (selector === "textarea") return [shadowInput];
    return [];
  }
};
const fakeHost = { shadowRoot };
const fakeDocument = {
  querySelectorAll(selector) {
    if (selector === "textarea") return [lightInput];
    if (selector === "*") return [fakeHost];
    return [];
  }
};
assert.deepEqual(
  adapters.queryInputCandidates(fakeDocument, { inputSelectors: ["textarea"] }),
  [lightInput, shadowInput]
);

const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
assert.ok(content.includes("localService.generate"));
assert.ok(content.includes("allowTemplateFallback"));
assert.ok(content.includes("composedPath"));
assert.ok(content.includes("bindShadowRootEvents"));
assert.ok(content.includes("bindInputElementEvents"));
assert.ok(content.includes("MutationObserver"));
assert.ok(content.includes("setInterval(refreshDynamicBindings"));
assert.ok(content.includes("getPathKind"));
assert.ok(content.includes("location.origin"));
assert.ok(!content.includes("url: location.href"));
assert.ok(!content.includes("title: document.title"));
assert.ok(!/document\.body\.(innerText|textContent|innerHTML)/.test(content));
assert.ok(!/document\.documentElement\.(innerText|textContent)/.test(content));
assert.ok(!/submit\s*\(/.test(content));
assert.ok(!/requestSubmit\s*\(/.test(content));
assert.ok(!/closest\(["']form["']\)/.test(content));
assert.ok(!/KeyboardEvent\([^)]*Enter/.test(content));

console.log("site-adapters tests passed");
