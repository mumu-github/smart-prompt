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

## API

- `GET /health`
- `GET /settings`
- `PUT /settings`
- `GET /skills`
- `POST /skills/import-folder` with `{ "path": "C:\\path\\to\\skills" }`
- `POST /skills/recommend`
- `POST /generate`

`/generate` uses an OpenAI-compatible chat completions gateway when `apiKey` or `OPENAI_API_KEY` is available. If the caller passes `allowTemplateFallback: true`, it falls back to local template generation when the LLM gateway is unavailable.

The service keeps `uploadWholePage` and `autoSubmit` forced to `false`.

## Test

```powershell
npm test
```
