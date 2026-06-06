# V2 Verification Status

Status: in progress

## Automated Evidence

- Local service tests: `apps/local-service npm test` passed in the latest automated V2 critic run.
- Local service API contract: `apps/local-service/README.md` defines JSON request/response contracts for health, settings, skill import, skill recommendation, and generation. The V2 critic checks that the contract includes the privacy invariants `uploadWholePage: false` and `autoSubmit: false`.
- Local prompt library: `apps/local-service/tests/local-service.test.js` verifies `POST /prompts`, `GET /prompts`, and `DELETE /prompts/:id`; `apps/desktop-shell/tests/desktop-shell.test.js` verifies the Tauri shell exposes a Prompt Library UI wired to `/prompts`.
- Three-mode LLM gateway test double: `apps/local-service/tests/local-service.test.js` injects `generateWithLlm` into the local service and verifies `/generate` returns `generatedBy: "llm"` for `idea`, `continue`, and `polish` with `allowTemplateFallback: false`.
- Multi-provider LLM gateway: `packages/shared/llm-gateway.js` now routes `openai-compatible`, `anthropic`, and `gemini` providers. The local-service tests verify Anthropic Messages and Gemini generateContent request/response adapters with provider-specific headers and fake responses.
- Browser extension tests: `prototypes/browser-extension npm test` passed in the latest automated V2 critic run.
- Insert strategy tests: `prototypes/browser-extension/tests/site-adapters.test.js` verifies ChatGPT, Claude, and Gemini adapter insert strategies and checks the content script does not call submit/requestSubmit, form submit paths, or Enter key auto-send behavior.
- Desktop shell static tests: `apps/desktop-shell npm test` passed in the latest automated V2 critic run.
- `LOCAL_SERVICE_BRIDGE_PASS`: `prototypes/browser-extension/tests/runtime-demo.test.js` starts or reuses the local service, launches Chrome headless through CDP, opens the demo page, confirms mascot + prompt card render, confirms the card is replaced by local-service output (`llm` or `template-fallback`), and confirms Insert writes back without submitting.
- `TAURI_BUILD_CHECK_PASS`: Rustup was installed through winget, `npx tauri info` reports WebView2/MSVC/rustc/cargo available, and `cargo check --manifest-path apps/desktop-shell/src-tauri/Cargo.toml` passes.
- `TAURI_START_PASS`: `scripts/check-v2-tauri-runtime.ps1` starts `npm run dev`, observes the running Tauri WebView through WebView2 CDP, confirms `window.__TAURI__` is available, and then cleans up the process tree.
- `GLOBAL_SHORTCUT_PASS`: `scripts/check-v2-tauri-runtime.ps1` invokes the runtime `set_global_shortcut` command, sends the registered `Ctrl+Alt+P` hotkey through Win32 keyboard events, and confirms the Rust shortcut hit counter increments through `get_shortcut_hits`.
- Tauri local service start: `scripts/check-v2-tauri-runtime.ps1` invokes `start_local_service` from the running Tauri app with a test port and confirms `/health` responds from `smart-prompt-local-service`.
- Live-site probe harness: `scripts/check-v2-live-sites.ps1` launches a temporary browser profile, loads the unpacked extension through the browser-level CDP `Extensions.loadUnpacked` command, checks live web AI pages, and writes `research/v2-live-site-probe.latest.json`. The probe records `injectedProbe: true` only when it must fall back to DevTools source injection; those fallback results are compatibility evidence, not formal extension-load pass markers.
- Authenticated Claude probe path: `scripts/check-v2-claude-insert.ps1` runs the same live-site probe with a persistent local Chrome profile, `SiteIds claude`, a login wait window, and an isolated report at `research/v2-claude-insert.latest.json` so Claude Insert can be proven after an interactive login without overwriting the 5-site report. This is a verification path, not a pass marker until the report contains `INSERT_CLAUDE_PASS`.
- `LIVE_5_SITES_PASS`: latest formal extension-loaded probe shows mascot display on ChatGPT, Gemini, Bolt, v0.app, and Lovable with `injectedProbe: false`.
- `INSERT_CHATGPT_PASS`: latest formal extension-loaded probe inserts into ChatGPT without auto-send and closes the card.
- `INSERT_GEMINI_PASS`: latest formal extension-loaded probe inserts into Gemini without auto-send and closes the card.

## Runtime Evidence Attempted But Not Passing

- Real LLM: `scripts/check-v2-real-llm.ps1` now supports OpenAI-compatible, Anthropic, and Gemini provider keys. The current User environment only exposes `OPENAI_API_KEY`, and that OpenAI-compatible request still returns HTTP 429 quota/billing failure on the first `idea` mode request, so the three-mode real LLM acceptance is not proven.
- Live sites: Claude Insert is still not proven because Claude redirects to sign-in/logout in the temporary browser profile. Perplexity is behind a challenge page, and Replit/DeepSeek/Doubao are login/region limited in this environment.

## Manual / Runtime Evidence Still Required

- Insert succeeds on Claude without auto-send.

Do not mark V2 complete until these runtime checks are replaced with concrete pass evidence.

Latest live-site probe proves formal extension display on 5 sites plus ChatGPT/Gemini Insert. Latest strict `scripts/critic-v2.ps1 -RequireRuntimeEvidence` fails only on missing `INSERT_CLAUDE_PASS`; default `scripts/critic-v2.ps1` still passes, and `scripts/check-v2-real-llm.ps1` still reaches the gateway but returns OpenAI HTTP 429 quota/billing failure.
