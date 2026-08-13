# Smart Prompt Local Service

V3 local service for settings, skill folder import, skill recommendation, prompt library management, and real LLM prompt generation.

## Start

```powershell
npm start
```

Default URL:

```text
http://127.0.0.1:17371
```

Default local data directory:

```text
apps/local-service/.smart-prompt-data
```

Set `SMART_PROMPT_DATA_DIR` to override it. The Tauri shell, manual local service runs, and V2 real LLM verification use the same default directory.

## Credential Storage

Provider API keys are not persisted in `settings.json`. The service stores provider/model/base URL settings in `settings.json`, and moves provider keys into `provider-keys.json` through the local credential vault.

On Windows the vault uses CurrentUser DPAPI. On other platforms, or if DPAPI is unavailable, it uses AES-256-GCM with a local install fallback secret; set `SMART_PROMPT_KEY_ENCRYPTION_SECRET` to provide an explicit encryption secret. `GET /settings` returns only redacted key summaries, while internal LLM generation reads decrypted keys in memory.

If an older `settings.json` contains `apiKey` or `providerKeys`, the next `getSettings()` call migrates those values into the vault and rewrites `settings.json` without plaintext keys.

## API Contract

All responses are JSON. Successful responses include `ok: true`; failures include `ok: false` and an `error` object with `code` and `message`.

CORS allows `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` only for trusted local clients such as the desktop shell, localhost development origins, and browser extension origins. The emitted method header remains `GET,POST,PUT,DELETE,OPTIONS`. Protected APIs do not emit `Access-Control-Allow-Origin: *`.

Protected APIs require the per-install local auth token. Clients should first call `GET /auth/bootstrap` from a trusted origin, then pass the token as either:

```text
Authorization: Bearer <token>
```

or:

```text
X-Smart-Prompt-Token: <token>
```

### `GET /health`

Public health check. It does not return the auth token.

Response:

```json
{ "ok": true, "service": "smart-prompt-local-service", "version": "0.2.0", "authRequired": true }
```

### `GET /auth/bootstrap`

Returns the per-install token only to trusted origins. This is used by the browser extension and desktop shell local bridge.

Response:

```json
{
  "ok": true,
  "auth": {
    "scheme": "Bearer",
    "header": "Authorization",
    "tokenHeader": "X-Smart-Prompt-Token",
    "token": "<per-install-token>"
  }
}
```

### `GET /settings`

Protected. Returns redacted settings. `apiKey` is never returned in full.

Response:

```json
{
  "ok": true,
  "settings": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "temperature": 0.35,
    "apiKey": "",
    "providerKeys": {
      "agnes": "",
      "openai-compatible": "sk-...abcd",
      "anthropic": "",
      "gemini": ""
    },
    "credentialStorage": {
      "encrypted": true,
      "storage": "windows-dpapi",
      "file": "provider-keys.json",
      "plaintextSettings": false
    },
    "uploadWholePage": false,
    "autoSubmit": false
  }
}
```

### `GET /llm/providers`

Returns provider readiness without exposing API keys.

Response:

```json
{
  "ok": true,
  "selected": "auto",
  "auto": { "provider": "anthropic" },
  "providers": [
    { "provider": "anthropic", "keyAvailable": true, "keySource": "ANTHROPIC_API_KEY" }
  ]
}
```

### `PUT /settings`

Request:

```json
{
  "settings": {
    "provider": "openai-compatible",
    "apiKey": "sk-test",
    "providerKeys": {
      "agnes": "sk-agnes-test",
      "anthropic": "sk-ant-test",
      "gemini": "gemini-test"
    },
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    "temperature": 0.35
  }
}
```

Response: same shape as `GET /settings`. The service forces `uploadWholePage` and `autoSubmit` to `false` even if the request tries to set them. Submitted keys are saved through the credential vault and are not written back to `settings.json` as plaintext.

Supported `provider` values:

- `auto`: try available provider keys from saved provider keys or environment variables in Agnes, Anthropic, Gemini, then OpenAI-compatible order. In auto mode, each provider uses its own default base URL/model, and a failed provider request can fall through to the next configured provider.
- `agnes`: Agnes OpenAI-compatible chat completions with `AGNES_API_KEY`; default base URL `https://apihub.agnes-ai.com/v1`, default model `agnes-2.0-flash`.
- `openai-compatible`: OpenAI-compatible chat completions with `OPENAI_API_KEY`.
- `anthropic`: Anthropic Messages API with `ANTHROPIC_API_KEY`.
- `gemini`: Gemini `generateContent` API with `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

### `GET /skills`

Response:

```json
{ "ok": true, "skills": [] }
```

### `GET /prompts`

Returns the local prompt library.

Response:

```json
{ "ok": true, "prompts": [] }
```

### `GET /diagnostics/export`

Protected. Exports a bounded diagnostics bundle with counts, metrics, credential storage summary, key migration status, and port recovery status. Prompt bodies and provider keys are not included.

### `DELETE /data/all`

Protected. Deletes local settings, provider keys, skills, prompts, history, metrics, metadata, and auth token, then creates a fresh empty local data store. Clients should clear their cached auth token and call `GET /auth/bootstrap` again.

### `POST /prompts`

Request:

```json
{
  "title": "CRM prompt",
  "body": "Build a CRM prompt with acceptance criteria.",
  "mode": "continue",
  "tags": ["crm", "acceptance"],
  "context": { "tool": "ChatGPT" }
}
```

Response includes the saved `prompt` and full `prompts` library.

### `DELETE /prompts/:id`

Deletes a saved prompt by id.

Response:

```json
{ "ok": true, "prompts": [] }
```

### `POST /skills/import-folder`

Request:

```json
{ "path": "C:\\path\\to\\skills" }
```

Response includes `imported` and the merged `skills` library.

### `DELETE /skills/:id`

Deletes an imported skill by id.

Response:

```json
{ "ok": true, "skills": [] }
```

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

`/generate` uses the configured provider and can read saved provider-specific keys or environment variables. If the caller passes `allowTemplateFallback: true`, it falls back to local template generation when the LLM gateway is unavailable.
The gateway supports Agnes/OpenAI-compatible chat completions, OpenAI-compatible chat completions, Anthropic Messages, and Gemini `generateContent`; `auto` can choose among all configured providers when keys are available and can try the next configured provider if one fails.

The service keeps `uploadWholePage` and `autoSubmit` forced to `false`.

### Desktop input APIs

Protected desktop input APIs are currently Windows-only. On non-Windows platforms, `GET /desktop/input-snapshot` and `POST /desktop/fill` return `pass:false`, `writeAttempted:false` for fill, and a `capability` object with `supported:false`, `requiredPlatform:"win32"`, `snapshotBackend:"none"`, `fillBackend:"none"`, and `unsupportedReason:"desktop_input_requires_windows_uia"`. macOS AXUIElement and Linux AT-SPI remain tracked as future backends, not current runtime behavior.

## Test

```powershell
npm test
```

Real LLM verification reads the saved provider settings by default:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\..\scripts\check-v2-real-llm.ps1
```
