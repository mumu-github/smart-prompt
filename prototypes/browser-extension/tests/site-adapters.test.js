const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const adapters = require("../src/site-adapters.js");
const sharedCore = require("../../../packages/shared/smart-prompt-core.js");

assert.ok(adapters.SITE_ADAPTERS.length >= 8);
const expectedAdapterIds = ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit"];
for (const id of expectedAdapterIds) {
  const adapter = adapters.SITE_ADAPTERS.find((item) => item.id === id);
  assert.ok(adapter, `missing adapter ${id}`);
  assert.ok(adapter.inputSelectors.length >= 3, `${id} should not rely on only generic selectors`);
  const shared = sharedCore.SITE_ADAPTERS.find((item) => item.id === id);
  assert.ok(shared, `shared core missing adapter ${id}`);
  assert.deepEqual(shared.hostnames, adapter.hostnames, `${id} hostnames drifted from shared core`);
  assert.deepEqual(shared.inputSelectors, adapter.inputSelectors, `${id} selectors drifted from shared core`);
  assert.equal(shared.insertStrategy, adapter.insertStrategy, `${id} strategy drifted from shared core`);
}
const expectedInsertStrategies = {
  chatgpt: "contenteditable-or-textarea",
  claude: "contenteditable-or-textarea",
  gemini: "contenteditable",
  perplexity: "contenteditable-or-textarea",
  lovable: "textarea-first",
  bolt: "textarea-first",
  v0: "textarea-first",
  replit: "textarea-first"
};
for (const [id, strategy] of Object.entries(expectedInsertStrategies)) {
  const adapter = adapters.SITE_ADAPTERS.find((item) => item.id === id);
  assert.equal(adapter.insertStrategy, strategy, `${id} insert strategy changed`);
}

const selectorExpectations = {
  chatgpt: "#prompt-textarea",
  claude: '[data-testid="chat-input"] div[contenteditable="true"]',
  gemini: "rich-textarea div[contenteditable=\"true\"]",
  perplexity: 'textarea[placeholder*="Ask"]',
  lovable: '[role="textbox"][aria-label="Chat input"]',
  bolt: '[role="textbox"][aria-label*="Type your idea"]',
  v0: 'textarea[id^="prompt-textarea"]',
  replit: 'textarea[placeholder*="Replit"]'
};
for (const [id, expectedSelector] of Object.entries(selectorExpectations)) {
  const adapter = adapters.SITE_ADAPTERS.find((item) => item.id === id);
  assert.ok(adapter.inputSelectors.includes(expectedSelector), `${id} missing selector ${expectedSelector}`);
}

assert.equal(adapters.detectSiteAdapter("chatgpt.com").id, "chatgpt");
assert.equal(adapters.detectSiteAdapter("claude.ai").id, "claude");
assert.equal(adapters.detectSiteAdapter("gemini.google.com").id, "gemini");
assert.equal(adapters.detectSiteAdapter("www.perplexity.ai").id, "perplexity");
assert.equal(adapters.detectSiteAdapter("bolt.new").id, "bolt");
assert.equal(adapters.detectSiteAdapter("lovable.dev").id, "lovable");
assert.equal(adapters.detectSiteAdapter("replit.com").id, "replit");
assert.equal(adapters.detectSiteAdapter("v0.app").id, "v0");
assert.equal(sharedCore.detectSiteAdapter("v0.app").id, "v0");

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
assert.ok(content.includes("lastAdapterId"));
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

const liveProbe = fs.readFileSync(path.join(__dirname, "live-site-probe.test.js"), "utf8");
assert.ok(liveProbe.includes("siteAdapters.SITE_ADAPTERS"));
assert.ok(liveProbe.includes("getProbeSelectors"));
assert.ok(liveProbe.includes("createCollectInputsSource"));
assert.ok(liveProbe.includes("inputSelectors:"));
assert.ok(liveProbe.includes("genericInputSelectors"));

console.log("site-adapters tests passed");
