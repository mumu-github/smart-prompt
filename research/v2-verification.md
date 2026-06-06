# V2 Verification Status

Status: in progress

## Automated Evidence

- Local service tests: `apps/local-service npm test` passed in the latest automated V2 critic run.
- Local service API contract: `apps/local-service/README.md` defines JSON request/response contracts for health, settings, skill import, skill recommendation, and generation. The V2 critic checks that the contract includes the privacy invariants `uploadWholePage: false` and `autoSubmit: false`.
- Local prompt and skill library management: `apps/local-service/tests/local-service.test.js` verifies skill folder import, `DELETE /skills/:id`, `POST /prompts`, `GET /prompts`, and `DELETE /prompts/:id`; `apps/desktop-shell/tests/desktop-shell.test.js` verifies the Tauri shell exposes Skill Library and Prompt Library management UI wired to `/skills`, `/prompts`, and delete actions.
- Three-mode LLM gateway test double: `apps/local-service/tests/local-service.test.js` injects `generateWithLlm` into the local service and verifies `/generate` returns `generatedBy: "llm"` for `idea`, `continue`, and `polish` with `allowTemplateFallback: false`.
- Multi-provider LLM gateway: `packages/shared/llm-gateway.js` now routes `auto`, `openai-compatible`, `anthropic`, and `gemini` providers. The local-service tests verify provider readiness, auto-provider selection, Anthropic Messages, and Gemini generateContent request/response adapters with provider-specific headers and fake responses.
- Auto provider fallback: `apps/local-service/tests/local-service.test.js` verifies `auto` uses provider-specific default model/base URL values and can continue from a failed Anthropic request to a configured Gemini request without falling back to templates.
- Provider key management: local-service settings and the desktop shell support provider-specific saved keys for OpenAI-compatible, Anthropic, and Gemini. `auto` can select saved Anthropic/Gemini keys instead of being limited to the legacy OpenAI-compatible key path.
- Settings persistence: the local service uses a stable default data directory at `apps/local-service/.smart-prompt-data`, and `scripts/check-v2-real-llm.ps1` reads the same saved settings by default so desktop-configured provider keys can be used for runtime verification.
- Browser extension tests: `prototypes/browser-extension npm test` passed in the latest automated V2 critic run.
- Insert strategy tests: `prototypes/browser-extension/tests/site-adapters.test.js` verifies ChatGPT, Claude, and Gemini adapter insert strategies and checks the content script does not call submit/requestSubmit, form submit paths, or Enter key auto-send behavior.
- Privacy context tests: `prototypes/browser-extension/tests/site-adapters.test.js` and `scripts/critic-v2.ps1` verify the content script does not include `location.href`, `document.title`, or whole-page `body`/`documentElement` text extraction in the default context sent to the local service; it sends host/origin/tool/inputKind plus a coarse `pathKind` instead.
- Desktop shell static tests: `apps/desktop-shell npm test` passed in the latest automated V2 critic run.
- `LOCAL_SERVICE_BRIDGE_PASS`: `prototypes/browser-extension/tests/runtime-demo.test.js` starts or reuses the local service, launches Chrome headless through CDP, opens the demo page, confirms mascot + prompt card render, confirms the card is replaced by local-service output (`llm` or `template-fallback`), and confirms Insert writes back without submitting.
- `TAURI_BUILD_CHECK_PASS`: Rustup was installed through winget, `npx tauri info` reports WebView2/MSVC/rustc/cargo available, and `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` passes.
- `TAURI_START_PASS`: `scripts/check-v2-tauri-runtime.ps1` starts `npm run dev`, observes the running Tauri WebView through WebView2 CDP, confirms `window.__TAURI__` is available, and then cleans up the process tree.
- `GLOBAL_SHORTCUT_PASS`: `scripts/check-v2-tauri-runtime.ps1` invokes the runtime `set_global_shortcut` command, sends the registered `Ctrl+Alt+P` hotkey through Win32 keyboard events, and confirms the Rust shortcut hit counter increments through `get_shortcut_hits`.
- Tauri local service start: `scripts/check-v2-tauri-runtime.ps1` invokes `start_local_service` from the running Tauri app with a test port and confirms `/health` responds from `smart-prompt-local-service`.
- Live-site probe harness: `scripts/check-v2-live-sites.ps1` launches a temporary browser profile, loads the unpacked extension through the browser-level CDP `Extensions.loadUnpacked` command, checks live web AI pages, and writes `research/v2-live-site-probe.latest.json`. The probe records `injectedProbe: true` only when it must fall back to DevTools source injection; those fallback results are compatibility evidence, not formal extension-load pass markers.
- Authenticated Claude probe path: `scripts/start-v2-claude-cdp.ps1` opens Claude in the persistent local Chrome profile with `--remote-debugging-port`, and prints the follow-up `scripts/check-v2-claude-insert.ps1 -AttachCdp` command. `scripts/check-v2-claude-insert.ps1` then runs the same live-site probe with `SiteIds claude` and an isolated report at `research/v2-claude-insert.latest.json` so Claude Insert can be proven after an interactive login without overwriting the 5-site report. This is a verification path, not a pass marker until the report contains `INSERT_CLAUDE_PASS`.
- Runtime evidence gate: `scripts/critic-v2.ps1 -RequireRuntimeEvidence` now requires machine-readable runtime reports. Live-site display/Insert must be proven by `research/v2-live-site-probe.latest.json`, Tauri startup/service/shortcut must be proven by `research/v2-tauri-runtime.latest.json`, Claude Insert must be proven by `research/v2-claude-insert.latest.json`, and real LLM generation must be proven by `research/v2-real-llm.latest.json` with `idea`, `continue`, and `polish` all returning `generatedBy: "llm"`.
- `LIVE_5_SITES_PASS`: latest formal extension-loaded probe shows mascot display on ChatGPT, Gemini, Bolt, v0.app, and Lovable with `injectedProbe: false`.
- `INSERT_CHATGPT_PASS`: latest formal extension-loaded probe inserts into ChatGPT without auto-send and closes the card.
- `INSERT_GEMINI_PASS`: latest formal extension-loaded probe inserts into Gemini without auto-send and closes the card.
- `INSERT_CLAUDE_PASS`: latest authenticated Claude probe at `research/v2-claude-insert.latest.json` loads the unpacked extension, shows the mascot on `https://claude.ai/new`, and inserts into Claude with `injectedProbe: false`, `passedDisplay: true`, and `passedInsert: true`.

## Runtime Evidence Attempted But Not Passing

- Real LLM: `scripts/check-v2-real-llm.ps1` now supports auto-selection across OpenAI-compatible, Anthropic, and Gemini provider keys and writes `research/v2-real-llm.latest.json`. It can read provider-specific keys saved by the desktop shell from the local-service data directory, can be pointed at a custom `-DataDir`, and supports `-Provider`, `-Model`, `-BaseUrl`, and `-DryRun` for checking configuration without sending a request. The current User environment only exposes `OPENAI_API_KEY`, and that OpenAI-compatible request still returns HTTP 429 quota/billing failure on the first `idea` mode request, so the three-mode real LLM acceptance is not proven.
- Live sites: Perplexity is behind a challenge page, and Replit/DeepSeek/Doubao are login/region limited in this environment.

## Manual / Runtime Evidence Still Required

- To preflight real LLM settings without spending quota: run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-v2-real-llm.ps1 -DryRun`. To force a saved provider path, add `-Provider anthropic`, `-Provider gemini`, or `-DataDir <local-service-data-dir>`.

Do not mark V2 complete until these runtime checks are replaced with concrete pass evidence.

Latest live-site probe proves formal extension display on 5 sites plus ChatGPT/Gemini Insert, the authenticated Claude probe proves Claude Insert, and the Tauri runtime report proves app startup, service launch, and global shortcut. Default `scripts/critic-v2.ps1` still passes. Strict `scripts/critic-v2.ps1 -RequireRuntimeEvidence` must remain failing until `research/v2-real-llm.latest.json` proves all three real LLM modes; the current real LLM report still reaches the gateway but returns OpenAI HTTP 429 quota/billing failure.
