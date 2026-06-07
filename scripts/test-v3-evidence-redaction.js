const assert = require("node:assert");
const { collectRedactionLeaks, redactEvidence } = require("../packages/shared/evidence-redaction");

const raw = {
  createdAt: "2026-06-07T00:00:00.000Z",
  apiKey: "sk-very-secret-test-key",
  authToken: "local-auth-token",
  profileDir: "C:\\Users\\lhy10\\Documents\\Smart Prompt\\.runtime\\profile",
  result: {
    url: "https://chatgpt.com/c/abc?model=gpt-4o&private=1",
    title: "Private chat title",
    prompt: "Full generated prompt that should not be stored in evidence.",
    value: "Inserted value that should not be stored either.",
    message: "Authorization: Bearer local-auth-token"
  }
};

const redacted = redactEvidence(raw);

assert.equal(redacted.apiKey, "[REDACTED_SECRET]");
assert.equal(redacted.authToken, "[REDACTED_SECRET]");
assert.equal(redacted.profileDir.redacted, "REDACTED_PATH");
assert.equal(redacted.result.url.redacted, "REDACTED_URL");
assert.equal(redacted.result.url.origin, "https://chatgpt.com");
assert.equal(redacted.result.url.pathKind, "multi-segment");
assert.equal(redacted.result.url.queryPresent, true);
assert.equal(redacted.result.title.redacted, "REDACTED_TEXT");
assert.equal(redacted.result.prompt.redacted, "REDACTED_TEXT");
assert.equal(redacted.result.value.redacted, "REDACTED_TEXT");
assert.ok(redacted.result.message.includes("[REDACTED_TOKEN]"));
assert.deepEqual(collectRedactionLeaks(redacted), []);

console.log("v3 evidence redaction tests passed");
