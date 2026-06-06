# Smart Prompt Local Service

V2 local service for settings, skill folder import, skill recommendation, and real LLM prompt generation.

## Start

```powershell
npm start
```

Default URL:

```text
http://127.0.0.1:17371
```

## API Contract

All responses are JSON. Successful responses include `ok: true`; failures include `ok: false` and an `error` object with `code` and `message`.

### `GET /health`

Response:

```json
{ "ok": true, "service": "smart-prompt-local-service", "version": "0.2.0" }
```

### `GET /settings`

Returns redacted settings. `apiKey` is never returned in full.

Response:

```json
{
  "ok": true,
  "settings": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "temperature": 0.35,
    "apiKey": "sk-...abcd",
    "uploadWholePage": false,
    "autoSubmit": false
  }
}
```

### `PUT /settings`

Request:

```json
{
  "settings": {
    "apiKey": "sk-test",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "temperature": 0.35
  }
}
```

Response: same shape as `GET /settings`. The service forces `uploadWholePage` and `autoSubmit` to `false` even if the request tries to set them.

### `GET /skills`

Response:

```json
{ "ok": true, "skills": [] }
```

### `POST /skills/import-folder`

Request:

```json
{ "path": "C:\\path\\to\\skills" }
```

Response includes `imported` and the merged `skills` library.

### `POST /skills/recommend`

Request:

```json
{
  "input": "Review this login flow",
  "context": { "tool": "ChatGPT", "host": "chatgpt.com" }
}
```

Response returns `1-3` recommended skills:

```json
{ "ok": true, "skills": [{ "name": "security-review" }] }
```

### `POST /generate`

Request:

```json
{
  "input": "Build a CRM",
  "mode": "continue",
  "context": { "tool": "ChatGPT", "host": "chatgpt.com", "inputKind": "textarea" },
  "variantIndex": 0,
  "allowTemplateFallback": false
}
```

Response:

```json
{
  "ok": true,
  "card": {
    "mode": "continue",
    "tool": "ChatGPT",
    "generatedBy": "llm",
    "prompt": "..."
  }
}
```

`/generate` uses an OpenAI-compatible chat completions gateway when `apiKey` or `OPENAI_API_KEY` is available. If the caller passes `allowTemplateFallback: true`, it falls back to local template generation when the LLM gateway is unavailable.

The service keeps `uploadWholePage` and `autoSubmit` forced to `false`.

## Test

```powershell
npm test
```
