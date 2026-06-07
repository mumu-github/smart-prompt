const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const adapters = require("../src/site-adapters.js");
const sharedCore = require("../../../packages/shared/smart-prompt-core.js");

assert.ok(adapters.SITE_ADAPTERS.length >= 12);
const expectedAdapterIds = ["chatgpt", "claude", "gemini", "perplexity", "lovable", "bolt", "v0", "replit", "workbuddy", "trae", "doubao", "deepseek"];
assert.deepEqual(adapters.SITE_ADAPTERS.map((adapter) => adapter.id), expectedAdapterIds);
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
  replit: "textarea-first",
  workbuddy: "textarea-first",
  trae: "textarea-first",
  doubao: "contenteditable-or-textarea",
  deepseek: "textarea-first"
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
  replit: 'textarea[placeholder*="Replit"]',
  workbuddy: 'textarea[placeholder*="work-buddy"]',
  trae: 'textarea[placeholder*="Trae"]',
  doubao: 'textarea[placeholder*="豆包"]',
  deepseek: 'textarea[placeholder*="DeepSeek"]'
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
assert.equal(adapters.detectSiteAdapter("www.work-buddy.ai").id, "workbuddy");
assert.equal(adapters.detectSiteAdapter("www.trae.ai").id, "trae");
assert.equal(adapters.detectSiteAdapter("www.doubao.com").id, "doubao");
assert.equal(adapters.detectSiteAdapter("chat.deepseek.com").id, "deepseek");
assert.equal(sharedCore.detectSiteAdapter("v0.app").id, "v0");
assert.equal(sharedCore.detectTool("", "Claude Code workspace"), "Claude Code");
assert.equal(sharedCore.detectTool("", "Hermes terminal"), "Hermes");

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

function createFakeInput(tagName, attrs = {}) {
  const events = [];
  return {
    tagName,
    value: "",
    textContent: "",
    innerText: "",
    isContentEditable: Boolean(attrs.contenteditable),
    focused: false,
    events,
    focus() {
      this.focused = true;
    },
    getAttribute(name) {
      return attrs[name] || "";
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  };
}

const fakeTextarea = createFakeInput("TEXTAREA");
const textareaResult = adapters.writeInput(fakeTextarea, "Textarea prompt", { insertStrategy: "textarea-first" });
assert.equal(textareaResult.ok, true);
assert.equal(textareaResult.verified, true);
assert.equal(textareaResult.kind, "native");
assert.equal(textareaResult.strategy, "textarea-first");
assert.equal(fakeTextarea.value, "Textarea prompt");
assert.ok(fakeTextarea.events.some((event) => event.type === "input" && event.composed === true));
assert.ok(fakeTextarea.events.some((event) => event.type === "change" && event.composed === true));

const fakeContenteditable = createFakeInput("DIV", { contenteditable: "true" });
const contenteditableResult = adapters.writeInput(fakeContenteditable, "Composer prompt", { insertStrategy: "contenteditable" });
assert.equal(contenteditableResult.ok, true);
assert.equal(contenteditableResult.verified, true);
assert.equal(contenteditableResult.kind, "contenteditable");
assert.equal(fakeContenteditable.textContent, "Composer prompt");
assert.ok(fakeContenteditable.events.some((event) => event.type === "input" && event.composed === true));

const fakeUnsupported = { tagName: "DIV", focus() {}, dispatchEvent() {} };
const failedResult = adapters.writeInput(fakeUnsupported, "Prompt", { insertStrategy: "textarea-first" });
assert.equal(failedResult.ok, false);
assert.equal(failedResult.verified, false);

const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
assert.ok(content.includes("localService.generate"));
assert.ok(content.includes("localService.savePrompt"));
assert.ok(content.includes("localService.recordMetric"));
assert.ok(content.includes("saveFavoriteLocally"));
assert.ok(content.includes("source: \"browser-extension\""));
assert.ok(content.includes("smartPromptFeedback"));
assert.ok(content.includes("allowTemplateFallback"));
assert.ok(content.includes("composedPath"));
assert.ok(content.includes("lastInsertResult"));
assert.ok(content.includes("smartPromptInsert"));
assert.ok(content.includes("smartprompt:insert-result"));
assert.ok(content.includes("spc-mode-selector"));
assert.ok(content.includes("data-action=\"retry\""));
assert.ok(content.includes("data-action=\"undo\""));
assert.ok(content.includes("smartPromptUndo"));
assert.ok(content.includes("spc-source-badge"));
assert.ok(content.includes("setCardStatus"));
assert.ok(content.includes("recordFeedbackEvent"));
assert.ok(content.includes("spc-evidence"));
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

const localServiceClient = fs.readFileSync(path.join(__dirname, "../src/local-service-client.js"), "utf8");
assert.ok(localServiceClient.includes("function savePrompt"));
assert.ok(localServiceClient.includes("function recordMetric"));
assert.ok(localServiceClient.includes("\"/prompts\""));
assert.ok(localServiceClient.includes("\"/metrics\""));
assert.ok(localServiceClient.includes("/auth/bootstrap"));
assert.ok(localServiceClient.includes("Authorization"));
assert.ok(localServiceClient.includes("authTokens"));

const demo = fs.readFileSync(path.join(__dirname, "../demo/demo.html"), "utf8");
assert.ok(demo.includes("__demoStorage"));
assert.ok(demo.includes("smartPromptSettings"));
assert.ok(demo.includes("serviceUrl"));
assert.ok(demo.includes("smartPromptFavorites") || demo.includes("Object.assign(window.__demoStorage"));

const liveProbe = fs.readFileSync(path.join(__dirname, "live-site-probe.test.js"), "utf8");
assert.ok(liveProbe.includes("siteAdapters.SITE_ADAPTERS"));
assert.ok(liveProbe.includes("getProbeSelectors"));
assert.ok(liveProbe.includes("createCollectInputsSource"));
assert.ok(liveProbe.includes("inputSelectors:"));
assert.ok(liveProbe.includes("genericInputSelectors"));
assert.ok(liveProbe.includes("v3-live-site-formal@1"));
assert.ok(liveProbe.includes("noAutoSend"));
assert.ok(liveProbe.includes("formalExtensionOnly"));
assert.ok(liveProbe.includes("smartPromptProbeInsertEvidence"));
assert.ok(liveProbe.includes("dom-evidence"));

const replit = adapters.SITE_ADAPTERS.find((adapter) => adapter.id === "replit");
assert.ok(replit.inputSelectors.some((selector) => selector.includes("Describe")));
assert.ok(replit.inputSelectors.some((selector) => selector.includes("plaintext-only")));

console.log("site-adapters tests passed");
